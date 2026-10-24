# Pack Jam: Zero Gap

Color Block Jam / Unblock Me görsel diliyle, oynanışı tersine çevrilmiş 3D mobil bulmaca prototipi. Amaç blokları dışarı çıkarmak değil: kuyrukta bekleyen eşyaları bavulun kenar kapılarından içeri itip ızgarayı **tek boş kare kalmadan %100** doldurmak.

Tek dosya: `index.html`. Tarayıcıda açman yeterli (Three.js r128, GSAP 3.12.5 ve fontlar CDN'den yüklenir).

## Nasıl oynanır

- **Kapıya dokun** ya da sıradaki tepsiyi kapıya sürükle. Eşya içeri girer ve bir şeye çarpana kadar kayar.
- İçerideki blokları **tutup boş yönlere kaydır**. `↔` / `↕` oklu bloklar sadece o eksende kayar ve sadece o eksendeki kapılardan girer.
- **Yaylı yumuşak eşyaları** (1×3) duvara ya da sert bir bloğa doğru itmeye devam et: 1×2'ye büzüşür.
- **Altın pimli blok** hiçbir yöne kayamayacak şekilde yerine oturunca, sırası gelen kapağı üstüne oturt.

### Booster'lar

| Booster | Etki |
| --- | --- |
| Geri Al | Son hamleyi geri alır (bölüm başına 5) |
| Vakum | Seçilen bloğu bir boy küçültür; açılan her kare için kuyruğun başına boş kareye konabilen bir joker çorap ekler (2) |
| Silkele | Bavulu sallar, tüm blokları seçilen yöne presleyip boşlukları kapatır (2) |

## Çözülebilirlik garantisi

Her bölüm yüklenirken tersine üretilir:

1. Izgara 1×1, 1×2, 1×3, 2×2, 2×3 parçalarla %100 döşenir.
2. Bloklar oyunun kendi kaydırma kurallarıyla kapılardan tek tek dışarı çıkarılır (yumuşak eşyalar genişletilir, gerekirse bloklar kaydırılır).
3. Çıkarma sırasının tersi oyuncunun kuyruğu olur; kapaklar, pimli bloğun kalıcı olarak oturduğu ana yerleştirilir.
4. Ortaya çıkan referans çözüm, gerçek kuyrukla oyun motorundan baştan sona yeniden oynatılır. Doğrulamayı geçemeyen bölüm oyuncuya gösterilmez.

İlk 5 bölüm sabit tohumlarla elle ayarlanmıştır (6×6 → 7×7); sonrasında 6×8 ve 7×8'e kadar büyüyen sonsuz bölümler gelir.

## Notlar

- Fare ve dokunmatik sürükleme desteklenir; ses WebAudio ile sentezlenir ve ilk dokunuştan sonra başlar.
- İlerleme ve ses tercihi tarayıcının `localStorage`'ında tutulur.
- Sıradaki 3 eşya görünür; garanti en az bir çözümün var olmasıdır, oyuncu kendi yolunda çıkmaza girebilir.
