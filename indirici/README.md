# Reel İndirici

Instagram reel ya da video linkini yapıştırıp indirmeni sağlayan küçük bir web sitesi (Flask + yt-dlp).

## Toplu indirme
**Toplu indir** sekmesine her satıra bir link yapıştır (en fazla 25), sonra **Hepsini indir (ZIP)**'e bas. Videolar sırayla indirilir ve hazır olunca tek ZIP dosyası olarak iner.
Sayfanın adresi (`?job=...`) bu işe özel. Kaydedip 1 saat içinde tekrar açabilirsin.

## Render'a kurulum
1. https://render.com/deploy?repo=https://github.com/Aexus2/rave adresine git ve `reel-indirici` servisini oluştur.
2. Render, `ACCESS_KEY` için rastgele bir anahtar üretir. Değeri Environment sekmesinde görürsün, sitede ilk kullanımda bunu girersin. Böylece siteyi senden başkası kullanamaz.
3. Instagram "giriş gerekli" hatası verirse tarayıcından dışa aktardığın `cookies.txt` içeriğini `IG_COOKIES` ortam değişkenine yapıştır.

## Yerelde çalıştırma
```bash
pip install -r requirements.txt
python app.py   # http://localhost:5000
```

Sadece herkese açık gönderiler indirilebilir. Videoları yeniden paylaşmadan önce sahibinden izin al.
