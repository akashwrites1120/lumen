import { writeFileSync, mkdirSync } from "node:fs";
import JSZip from "jszip";

const outPath = process.argv[2] ?? ".data/fixture/book.epub";
mkdirSync(outPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });

function png(width, height, rgbFn) {
  const idat = [];
  for (let y = 0; y < height; y++) {
    idat.push(0);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgbFn(x, y);
      idat.push(r, g, b);
    }
  }
  return pngFromRaw(width, height, Buffer.from(idat));
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngFromRaw(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type rgb
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", raw),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const imgSunset = png(64, 64, (x, y) => [220 - y * 2, 140 - x, 60 + ((x + y) % 30)]);
const imgChartBars = png(64, 64, (x) => (x % 16 < 6 ? [217, 119, 6] : [245, 241, 236]));

const zip = new JSZip();
zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
zip.file(
  "META-INF/container.xml",
  `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
);

zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12345678-aaaa-bbbb-cccc-ddddeeeeffff</dc:identifier>
    <dc:title>Lumen Fixture Book</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Test Suite</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img-sunset" href="images/sunset.png" media-type="image/png"/>
    <item id="img-chart" href="images/chart-bars.png" media-type="image/png"/>
    <item id="img-dup" href="images/duplicate-of-sunset.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`);

zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol>
<li><a href="ch1.xhtml">Chapter One</a></li>
<li><a href="ch2.xhtml">Chapter Two</a></li>
</ol></nav></body></html>`);

zip.file("OEBPS/ch1.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter One</title></head>
<body>
<h1>Chapter One: The Beginning</h1>
<p>This paragraph introduces the book and references Figure 1 below.</p>
<img src="images/sunset.png" alt=""/>
<p>Another paragraph of body text follows the image.</p>
<ul><li>First point</li><li>Second point</li></ul>
</body></html>`);

zip.file("OEBPS/ch2.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter Two</title></head>
<body>
<h1>Chapter Two: The Data</h1>
<p>A chart appears here as Figure 2.</p>
<img src="images/chart-bars.png" alt=""/>
<p>The next image is an exact duplicate of Figure 1 and should be deduplicated.</p>
<img src="images/duplicate-of-sunset.png" alt=""/>
<ol><li>Step one</li><li>Step two</li></ol>
</body></html>`);

zip.file("OEBPS/images/sunset.png", imgSunset);
zip.file("OEBPS/images/chart-bars.png", imgChartBars);
zip.file("OEBPS/images/duplicate-of-sunset.png", imgSunset);

const content = await zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip" });
writeFileSync(outPath, content);
console.log(`wrote ${outPath} (${content.length} bytes, 3 images / 2 unique)`);
