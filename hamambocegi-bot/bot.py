#!/usr/bin/env python3
"""
Hamamböceği izinli repost botu.

Akış:  add -> dm -> requested -> approve -> post
Sadece sahibinden İZİN ALINMIŞ (approved) videolar indirilir ve X'te paylaşılır.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")

DB_PATH = BASE / "data.db"
DL_DIR = BASE / "downloads"

DM_TEMPLATE = os.getenv(
    "DM_TEMPLATE",
    "Merhaba @{owner}! 👋 Bu videonu çok beğendik: {url}\n"
    "X'teki hamamböceği sayfamızda seni etiketleyerek (@{owner}) paylaşmamıza izin verir misin? "
    "İstemezsen hiç sorun değil, teşekkürler! 🪳",
)
CAPTION_TEMPLATE = os.getenv(
    "CAPTION_TEMPLATE",
    "{caption}\n\n🎥 Instagram: @{owner} (izinle paylaşılmıştır)",
)

STATUSES = ["new", "requested", "approved", "rejected", "posted", "failed"]


# --------------------------------------------------------------------------- DB
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(
        """CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            owner TEXT NOT NULL,
            caption TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new',
            permission_note TEXT DEFAULT '',
            file_path TEXT DEFAULT '',
            tweet_id TEXT DEFAULT '',
            error TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT
        )"""
    )
    return con


def now():
    return datetime.now().isoformat(timespec="seconds")


def get(con, vid):
    row = con.execute("SELECT * FROM videos WHERE id=?", (vid,)).fetchone()
    if not row:
        sys.exit(f"#{vid} bulunamadı.")
    return row


def update(con, vid, **fields):
    fields["updated_at"] = now()
    cols = ", ".join(f"{k}=?" for k in fields)
    con.execute(f"UPDATE videos SET {cols} WHERE id=?", (*fields.values(), vid))
    con.commit()


# ------------------------------------------------------------------- Commands
def cmd_add(a):
    con = db()
    owner = a.owner.lstrip("@")
    try:
        con.execute(
            "INSERT INTO videos (url, owner, caption, created_at, updated_at) VALUES (?,?,?,?,?)",
            (a.url.strip(), owner, a.caption or "", now(), now()),
        )
        con.commit()
    except sqlite3.IntegrityError:
        sys.exit("Bu link zaten listede.")
    vid = con.execute("SELECT last_insert_rowid()").fetchone()[0]
    print(f"✅ #{vid} eklendi (@{owner}). İzin mesajı için: python bot.py dm {vid}")


def cmd_list(a):
    con = db()
    q, args = "SELECT * FROM videos", ()
    if a.status:
        q, args = q + " WHERE status=?", (a.status,)
    rows = con.execute(q + " ORDER BY id", args).fetchall()
    if not rows:
        print("Liste boş.")
        return
    for r in rows:
        extra = f"  tweet:{r['tweet_id']}" if r["tweet_id"] else ""
        extra += f"  hata:{r['error'][:60]}" if r["error"] else ""
        print(f"#{r['id']:<4} {r['status']:<10} @{r['owner']:<20} {r['url']}{extra}")


def cmd_dm(a):
    con = db()
    r = get(con, a.id)
    print("---- Instagram'dan bu mesajı gönder ----")
    print(DM_TEMPLATE.format(owner=r["owner"], url=r["url"]))
    print("----------------------------------------")
    print(f"Profil: https://instagram.com/{r['owner']}")
    if r["status"] == "new":
        update(con, a.id, status="requested")
        print(f"#{a.id} durumu -> requested")


def cmd_approve(a):
    con = db()
    get(con, a.id)
    if not a.note:
        sys.exit("İzin kanıtı notu zorunlu, ör: --note 'DM 19.11.2026: evet dedi'")
    update(con, a.id, status="approved", permission_note=a.note)
    print(f"✅ #{a.id} onaylandı.")


def cmd_reject(a):
    con = db()
    get(con, a.id)
    update(con, a.id, status="rejected", permission_note=a.note or "")
    print(f"#{a.id} reddedildi, paylaşılmayacak.")


def cmd_attach(a):
    """Sahibi videoyu doğrudan gönderdiyse dosyayı bağla (indirmeye gerek kalmaz)."""
    con = db()
    get(con, a.id)
    p = Path(a.file).expanduser().resolve()
    if not p.exists():
        sys.exit(f"Dosya yok: {p}")
    update(con, a.id, file_path=str(p))
    print(f"#{a.id} -> {p}")


def cmd_caption(a):
    con = db()
    get(con, a.id)
    update(con, a.id, caption=a.text)
    print(f"#{a.id} açıklaması güncellendi.")


# ------------------------------------------------------------------ Download
def download(row):
    if row["file_path"] and Path(row["file_path"]).exists():
        return row["file_path"]
    import yt_dlp

    DL_DIR.mkdir(exist_ok=True)
    opts = {
        "outtmpl": str(DL_DIR / f"{row['id']}.%(ext)s"),
        "format": "mp4/bestvideo+bestaudio/best",
        "merge_output_format": "mp4",
        "quiet": True,
        "noplaylist": True,
    }
    cookies = os.getenv("IG_COOKIES_FILE")
    if cookies:
        opts["cookiefile"] = cookies
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(row["url"], download=True)
        path = ydl.prepare_filename(info)
    mp4 = Path(path).with_suffix(".mp4")
    return str(mp4 if mp4.exists() else path)


# ------------------------------------------------------------------- X API
class XClient:
    API = "https://api.x.com/2"
    CHUNK = 4 * 1024 * 1024

    def __init__(self):
        from requests_oauthlib import OAuth1Session

        keys = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"]
        missing = [k for k in keys if not os.getenv(k)]
        if missing:
            sys.exit(f".env içinde eksik: {', '.join(missing)}")
        self.s = OAuth1Session(*(os.getenv(k) for k in keys))

    def _check(self, r):
        if r.status_code >= 400:
            raise RuntimeError(f"X API {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else {}

    def upload_video(self, path):
        size = os.path.getsize(path)
        init = self._check(
            self.s.post(
                f"{self.API}/media/upload/initialize",
                json={"media_type": "video/mp4", "total_bytes": size, "media_category": "tweet_video"},
            )
        )
        media_id = init["data"]["id"]
        with open(path, "rb") as f:
            i = 0
            while chunk := f.read(self.CHUNK):
                self._check(
                    self.s.post(
                        f"{self.API}/media/upload/{media_id}/append",
                        data={"segment_index": i},
                        files={"media": chunk},
                    )
                )
                i += 1
        fin = self._check(self.s.post(f"{self.API}/media/upload/{media_id}/finalize"))
        info = fin.get("data", {}).get("processing_info")
        while info and info.get("state") in ("pending", "in_progress"):
            time.sleep(info.get("check_after_secs", 3))
            st = self._check(
                self.s.get(f"{self.API}/media/upload", params={"command": "STATUS", "media_id": media_id})
            )
            info = st.get("data", {}).get("processing_info")
        if info and info.get("state") == "failed":
            raise RuntimeError(f"Video işlenemedi: {json.dumps(info)}")
        return media_id

    def tweet(self, text, media_id):
        r = self._check(
            self.s.post(f"{self.API}/tweets", json={"text": text, "media": {"media_ids": [media_id]}})
        )
        return r["data"]["id"]


def build_text(row):
    text = CAPTION_TEMPLATE.format(caption=row["caption"] or "🪳", owner=row["owner"], url=row["url"]).strip()
    return text[:280]


def cmd_post(a):
    con = db()
    rows = con.execute(
        "SELECT * FROM videos WHERE status='approved' ORDER BY id LIMIT ?", (a.count,)
    ).fetchall()
    if not rows:
        print("Paylaşılacak onaylı video yok.")
        return
    client = None if a.dry_run else XClient()
    for r in rows:
        # Güvenlik: izin notu olmayan asla paylaşılmaz
        if not r["permission_note"]:
            print(f"#{r['id']} atlandı: izin notu yok.")
            continue
        text = build_text(r)
        try:
            path = download(r)
            update(con, r["id"], file_path=path)
            if a.dry_run:
                print(f"[DRY-RUN] #{r['id']} dosya: {path}\n{text}\n")
                continue
            media_id = client.upload_video(path)
            tid = client.tweet(text, media_id)
            update(con, r["id"], status="posted", tweet_id=tid, error="")
            print(f"🚀 #{r['id']} paylaşıldı: https://x.com/i/status/{tid}")
        except Exception as e:  # noqa: BLE001
            update(con, r["id"], status="failed", error=str(e))
            print(f"❌ #{r['id']} hata: {e}")


def cmd_retry(a):
    con = db()
    get(con, a.id)
    update(con, a.id, status="approved", error="")
    print(f"#{a.id} tekrar kuyruğa alındı.")


# ----------------------------------------------------------------------- CLI
def main():
    p = argparse.ArgumentParser(description="İzinli Instagram -> X repost botu")
    sp = p.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("add", help="Instagram video linki ekle")
    s.add_argument("url")
    s.add_argument("--owner", required=True, help="Video sahibinin IG kullanıcı adı")
    s.add_argument("--caption", default="", help="Tweet metni")
    s.set_defaults(f=cmd_add)

    s = sp.add_parser("list", help="Listeyi göster")
    s.add_argument("--status", choices=STATUSES)
    s.set_defaults(f=cmd_list)

    s = sp.add_parser("dm", help="İzin mesajı taslağını göster")
    s.add_argument("id", type=int)
    s.set_defaults(f=cmd_dm)

    s = sp.add_parser("approve", help="Sahibi izin verdi")
    s.add_argument("id", type=int)
    s.add_argument("--note", required=True, help="İzin kanıtı (tarih, nerede, ne dedi)")
    s.set_defaults(f=cmd_approve)

    s = sp.add_parser("reject", help="Sahibi izin vermedi")
    s.add_argument("id", type=int)
    s.add_argument("--note", default="")
    s.set_defaults(f=cmd_reject)

    s = sp.add_parser("attach", help="Sahibinin gönderdiği dosyayı bağla")
    s.add_argument("id", type=int)
    s.add_argument("file")
    s.set_defaults(f=cmd_attach)

    s = sp.add_parser("caption", help="Tweet metnini değiştir")
    s.add_argument("id", type=int)
    s.add_argument("text")
    s.set_defaults(f=cmd_caption)

    s = sp.add_parser("post", help="Onaylıları indir ve X'te paylaş")
    s.add_argument("--count", type=int, default=1, help="Bu çalıştırmada kaç video")
    s.add_argument("--dry-run", action="store_true", help="Tweet atmadan dene")
    s.set_defaults(f=cmd_post)

    s = sp.add_parser("retry", help="Hatalı olanı tekrar kuyruğa al")
    s.add_argument("id", type=int)
    s.set_defaults(f=cmd_retry)

    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
