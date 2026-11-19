"""Instagram video indirici - kişisel kullanım için küçük web uygulaması."""
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, after_this_request, jsonify, request, send_file

app = Flask(__name__, static_folder="static", static_url_path="")

ACCESS_KEY = os.getenv("ACCESS_KEY", "")
ALLOWED_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
PATH_RE = re.compile(r"^/(reel|reels|p|tv)/[A-Za-z0-9_-]+/?$")
MAX_BYTES = 300 * 1024 * 1024

COOKIE_FILE = None
if os.getenv("IG_COOKIES"):
    COOKIE_FILE = Path(tempfile.gettempdir()) / "ig_cookies.txt"
    COOKIE_FILE.write_text(os.environ["IG_COOKIES"])


def check_key():
    if ACCESS_KEY and request.headers.get("X-Access-Key") != ACCESS_KEY and request.args.get("key") != ACCESS_KEY:
        return jsonify(error="Erişim anahtarı yanlış."), 401
    return None


def clean_url(raw):
    raw = (raw or "").strip()
    u = urlparse(raw)
    if u.scheme not in ("http", "https") or u.hostname not in ALLOWED_HOSTS:
        return None
    if not PATH_RE.match(u.path):
        return None
    return f"https://www.instagram.com{u.path}"


def ydl_opts(**extra):
    o = {
        "quiet": True,
        "noplaylist": True,
        "format": "best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]/best",
        "max_filesize": MAX_BYTES,
    }
    if COOKIE_FILE:
        o["cookiefile"] = str(COOKIE_FILE)
    o.update(extra)
    return o


def friendly(e):
    msg = str(e)
    if "login" in msg.lower() or "cookies" in msg.lower() or "rate" in msg.lower():
        return "Instagram giriş istedi ya da isteği engelledi. Sunucuya IG_COOKIES ekle veya biraz sonra tekrar dene."
    if "private" in msg.lower():
        return "Bu gönderi gizli hesaba ait."
    return "Video alınamadı. Link doğru mu, gönderide video var mı?"


@app.get("/api/info")
def info():
    if (err := check_key()):
        return err
    url = clean_url(request.args.get("url"))
    if not url:
        return jsonify(error="Geçerli bir Instagram reel/gönderi linki gir."), 400
    try:
        with yt_dlp.YoutubeDL(ydl_opts()) as ydl:
            i = ydl.extract_info(url, download=False)
    except Exception as e:  # noqa: BLE001
        app.logger.warning("info hata: %s", e)
        return jsonify(error=friendly(e)), 502
    if i.get("_type") == "playlist" and i.get("entries"):
        i = next((x for x in i["entries"] if x.get("vcodec") not in (None, "none")), i["entries"][0])
    return jsonify(
        title=(i.get("description") or i.get("title") or "")[:200],
        owner=i.get("uploader_id") or i.get("channel") or i.get("uploader") or "",
        thumbnail=i.get("thumbnail"),
        duration=i.get("duration"),
        url=url,
    )


@app.get("/api/download")
def download():
    if (err := check_key()):
        return err
    url = clean_url(request.args.get("url"))
    if not url:
        return jsonify(error="Geçerli bir Instagram linki gir."), 400
    tmp = tempfile.mkdtemp(prefix="igdl_")

    @after_this_request
    def cleanup(resp):
        resp.call_on_close(lambda: shutil.rmtree(tmp, ignore_errors=True))
        return resp

    try:
        with yt_dlp.YoutubeDL(ydl_opts(outtmpl=f"{tmp}/%(id)s.%(ext)s")) as ydl:
            i = ydl.extract_info(url, download=True)
    except Exception as e:  # noqa: BLE001
        app.logger.warning("indirme hata: %s", e)
        return jsonify(error=friendly(e)), 502
    files = [p for p in Path(tmp).iterdir() if p.is_file()]
    if not files:
        return jsonify(error="Video dosyası bulunamadı."), 502
    f = max(files, key=lambda p: p.stat().st_size)
    owner = re.sub(r"[^A-Za-z0-9_.-]", "", i.get("uploader_id") or "instagram")
    return send_file(f, as_attachment=True, download_name=f"{owner}_{i.get('id', 'video')}{f.suffix}")


# ------------------------------------------------------------ Toplu indirme
MAX_BULK = 25
JOB_TTL = 60 * 60  # ZIP 1 saat saklanır
JOBS = {}
JOBS_LOCK = threading.Lock()


def _gc_jobs():
    cutoff = time.time() - JOB_TTL
    with JOBS_LOCK:
        for jid in [j for j, v in JOBS.items() if v["created"] < cutoff]:
            shutil.rmtree(JOBS.pop(jid)["dir"], ignore_errors=True)


def _run_job(jid):
    job = JOBS[jid]
    vids = Path(job["dir"]) / "videos"
    vids.mkdir()
    for item in job["items"]:
        item["status"] = "indiriliyor"
        try:
            tmpl = f"{vids}/%(uploader_id,uploader|instagram)s_%(id)s.%(ext)s"
            with yt_dlp.YoutubeDL(ydl_opts(outtmpl=tmpl)) as ydl:
                ydl.extract_info(item["url"], download=True)
            item["status"] = "tamam"
        except Exception as e:  # noqa: BLE001
            app.logger.warning("toplu hata %s: %s", item["url"], e)
            item["status"] = "hata"
            item["error"] = friendly(e)
        time.sleep(2)  # Instagram'ı boğmamak için
    files = sorted(p for p in vids.iterdir() if p.is_file())
    if files:
        zpath = Path(job["dir"]) / "videolar.zip"
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_STORED) as z:
            for f in files:
                z.write(f, f.name)
        shutil.rmtree(vids, ignore_errors=True)
        job["zip"] = str(zpath)
    job["done"] = True


@app.post("/api/bulk")
def bulk_start():
    if (err := check_key()):
        return err
    _gc_jobs()
    raw = (request.get_json(silent=True) or {}).get("urls", "")
    lines = raw if isinstance(raw, list) else re.split(r"[\s,]+", raw)
    urls, bad = [], []
    for line in lines:
        if not line.strip():
            continue
        u = clean_url(line)
        (urls if u else bad).append(u or line.strip())
    urls = list(dict.fromkeys(urls))
    if not urls:
        return jsonify(error="Geçerli Instagram linki bulunamadı."), 400
    if len(urls) > MAX_BULK:
        return jsonify(error=f"Tek seferde en fazla {MAX_BULK} link."), 400
    jid = uuid.uuid4().hex
    JOBS[jid] = {
        "created": time.time(),
        "dir": tempfile.mkdtemp(prefix="igbulk_"),
        "items": [{"url": u, "status": "sırada"} for u in urls],
        "done": False,
        "zip": None,
    }
    threading.Thread(target=_run_job, args=(jid,), daemon=True).start()
    return jsonify(id=jid, count=len(urls), skipped=bad)


@app.get("/api/bulk/<jid>")
def bulk_status(jid):
    if (err := check_key()):
        return err
    job = JOBS.get(jid)
    if not job:
        return jsonify(error="İş bulunamadı ya da süresi doldu."), 404
    return jsonify(done=job["done"], has_zip=bool(job["zip"]), items=job["items"])


@app.get("/api/bulk/<jid>/zip")
def bulk_zip(jid):
    if (err := check_key()):
        return err
    job = JOBS.get(jid)
    if not job or not job.get("zip"):
        return jsonify(error="ZIP hazır değil ya da süresi doldu."), 404
    return send_file(job["zip"], as_attachment=True, download_name="instagram_videolar.zip")


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/healthz")
def health():
    return "ok"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=False)
