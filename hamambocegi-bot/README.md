# 🪳 İzinli Repost Botu (Instagram → X)

Instagram'da bulduğun hamamböceği videolarını **sahibinden izin alarak** indirip X'te kaynak etiketiyle paylaşır.

## Kurulum

```bash
pip install -r requirements.txt
cp .env.example .env   # X API anahtarlarını doldur
```

Ayrıca `ffmpeg` kurulu olmalı (`apt install ffmpeg` / `brew install ffmpeg`).

## Akış

```bash
# 1) Videoyu listeye ekle
python bot.py add "https://www.instagram.com/reel/XXXX/" --owner kullaniciadi --caption "Gece 3'te mutfak 🪳"

# 2) İzin mesajını al, Instagram'dan sahibine DM at
python bot.py dm 1

# 3a) Evet dediyse (kanıt notu zorunlu)
python bot.py approve 1 --note "DM 19.11.2026, 'tabii paylaşın' dedi"
# 3b) Hayır dediyse
python bot.py reject 1

# 4) Önce deneme, sonra gerçek paylaşım
python bot.py post --dry-run
python bot.py post --count 1
```

Diğer komutlar:
- `list [--status approved]` listeyi gösterir.
- `attach 1 video.mp4` sahibi dosyayı doğrudan gönderdiyse onu kullanır.
- `caption 1 "yeni metin"` tweet metnini değiştirir.
- `retry 1` hata veren videoyu tekrar kuyruğa alır.

## Zamanlama (günde 3 paylaşım örneği, cron)

```
0 10,15,20 * * * cd /yol/rave/hamambocegi-bot && /usr/bin/python3 bot.py post --count 1 >> bot.log 2>&1
```

## Kurallar
- `approved` durumunda olmayan ve izin notu bulunmayan hiçbir video indirilmez ya da paylaşılmaz.
- Her tweet'te video sahibinin @kullanıcı adı yer alır.
- Sahibi sonradan kaldırmanı isterse tweet'i sil.

## GitHub Actions ile otomatik çalıştırma (bilgisayar gerekmez)

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.
   İsteğe bağlı olarak `IG_COOKIES` ekle (cookies.txt dosyasının içeriği).
2. Bot her gün 10:00, 15:00 ve 20:00'de (TR saati) sıradaki 1 onaylı videoyu paylaşır.
3. Komutları telefondan çalıştırmak için: **Actions → hamambocegi-bot → Run workflow**. Komutu seç, argümanları yaz:
   - add: `"https://www.instagram.com/reel/XXX/" --owner kullanici --caption "metin"`
   - dm / retry: `1`
   - approve: `1 --note "DM 19.11.2026 evet dedi"`
   - post: `--count 1 --dry-run`
   Çıktıyı (örneğin DM metnini) çalıştırmanın loglarında görürsün. Durum `data.db` dosyasında tutulur ve her çalıştırmadan sonra repoya otomatik commit'lenir.
