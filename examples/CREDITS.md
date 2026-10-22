# Image credits

Every image in `examples/images/`, `examples/posters/` and `docs/shots/` is public domain or CC0, except the ink drop, which is the FateTell mark: © FateTell, all rights reserved, included here only as a demonstration subject (see the exception at the end of [LICENSE](../LICENSE)). Forks and redistributions must remove it. Each license below was checked against the source's own machine-readable metadata (the Wikimedia Commons `extmetadata` and page wikitext, the Met collection API's `isPublicDomain`, and the Smithsonian Open Access API's `metadata_usage.access`).

Processing for every image except the ink drop:
- Downscaled to ≤ 1024 px (Pillow, Lanczos).
- Backgrounds removed with `scripts/cutout.py`; the exact command for each image is listed below. The moon maps were only resized.
- Saved as WebP (quality 92, lossless alpha).

`examples/posters/` holds still frames rendered from these images by silkify itself (`node scripts/shoot.mjs --posters`). They carry the same terms as their source image.

| File | Work | Source | License |
|---|---|---|---|
| `ink-drop.webp` | FateTell logo (brand mark) | FateTell | © FateTell, all rights reserved. **Not** covered by the MIT license; no rights granted. Remove from forks and redistributions. |
| `moon.webp` | Moon colour map, LRO LROC WAC mosaic with polar fill, 2K equirectangular (`lroc_color_poles_2k.tif`) | NASA Scientific Visualization Studio, "CGI Moon Kit" (2019), visualizer Ernie Wright (USRA); data from LRO LROC and LOLA: https://svs.gsfc.nasa.gov/4720 (file: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif) | Public domain (NASA imagery, not copyrighted). Credit: NASA's Scientific Visualization Studio |
| `moon-bump.webp` | Lunar elevation, LOLA LDEM 8-bit, 1024 × 512 (`ldem_3_8bit.jpg`) | Same page: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg | Public domain (NASA). Credit: NASA's Scientific Visualization Studio |
| `pomegranate.webp` | "Wonderful" pomegranate, watercolour by Amanda Almira Newton, 1920. USDA Pomological Watercolor Collection, National Agricultural Library | https://commons.wikimedia.org/wiki/File:Pomological_Watercolor_POM00007516.jpg | Public domain (US government work) |
| `hare.webp` | *Young Hare* (*Feldhase*), Albrecht Dürer, 1502. Albertina, Vienna (via Google Arts & Culture) | https://commons.wikimedia.org/wiki/File:Albrecht_D%C3%BCrer_-_Hare,_1502_-_Google_Art_Project.jpg | Public domain |
| `teapot.webp` | *Teapot and Cover*, England, c. 1800, enamelled and gilt tôle with wicker handle. Cooper Hewitt, Smithsonian Design Museum, 1915-16-6-a/c | https://commons.wikimedia.org/wiki/File:Teapot_And_Cover_(England),_ca._1800_(CH_18185679).jpg | Public domain (PD-old-100-1923); photo CC0 per Smithsonian Open Access |
| `mona-lisa.webp` | *Mona Lisa*, Leonardo da Vinci, c. 1503–1519. Musée du Louvre (C2RMF scan, retouched) | https://commons.wikimedia.org/wiki/File:Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg | Public domain |
| `carriera.webp` | *Portrait of a Man*, Rosalba Carriera, c. 1710, ivory. The Metropolitan Museum of Art, Rogers Fund, 1949 | https://www.metmuseum.org/art/collection/search/435854 (file: https://images.metmuseum.org/CRDImages/ep/original/DT200586.jpg) | Public domain (Met Open Access, CC0) |
| `parrot.webp` | *Bird Figure*, possibly 18th century, gold, enamel and gemstones. Cooper Hewitt, Smithsonian Design Museum, 1996-19-1 | https://commons.wikimedia.org/wiki/File:Bird_Figure,_possibly_18th_century_(CH_18653379).jpg | Public domain (PD-old-100-1923); photo CC0 per Smithsonian Open Access |

## Cut-out commands

These are the exact commands used. The source files are the ones linked above: for Commons, the 1920 px rendition; for the Met, the original. Each PNG was then converted to WebP.

```bash
python3 scripts/cutout.py pomegranate.jpg pomegranate.png --crop 390,510,1550,1730 --keep-largest
python3 scripts/cutout.py hare.jpg hare.png --crop 60,60,1860,1960 --tolerance 0.10 \
        --shadow-box 1150,1180,1900,1900 --shadow-chroma 0.03 --keep-largest
python3 scripts/cutout.py teapot.jpg teapot.png --crop 340,420,1580,1340 --no-flood \
        --shadow-box 340,1040,1580,1340 --keep-largest
python3 scripts/cutout.py mona-lisa.jpg mona-lisa.png --rect
python3 scripts/cutout.py carriera.jpg carriera.png --crop 90,95,1395,1700 --keep-largest
python3 scripts/cutout.py parrot.jpg parrot.png --crop 330,40,1620,1850 --shadow-box 330,1350,1620,1850 --keep-largest
```
