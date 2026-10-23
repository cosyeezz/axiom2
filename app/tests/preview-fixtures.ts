import { crc32 } from "node:zlib";
/** Stored ZIP fixtures; CRC and offsets are real so validation stays enabled. */
export function fixtureZip(files: Record<string, string | Buffer>, mode = 0o100644) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value), path = Buffer.from(name);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc32(body), 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(path.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE((mode * 65536) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    locals.push(header, path, body); central.push(directory, path); offset += header.length + path.length + body.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}
export const wordFixture = () => fixtureZip({ "[Content_Types].xml": '<Types/>', "word/document.xml": '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>文档正文 &amp; 安全阅读</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' });
export const sheetFixture = () => fixtureZip({ "[Content_Types].xml": '<Types/>', "xl/workbook.xml": '<workbook xmlns:r="relations"><sheets><sheet name="数据表" r:id="r1"/></sheets></workbook>', "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>', "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>销售</t></is></c><c r="C1"><v>42</v></c></row></sheetData></worksheet>' });
export const slidesFixture = () => fixtureZip({ "[Content_Types].xml": '<Types/>', "ppt/presentation.xml": '<p:presentation xmlns:p="presentation" xmlns:r="relations"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst></p:presentation>', "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>', "ppt/slides/slide1.xml": '<p:sld xmlns:p="presentation" xmlns:a="drawing"><a:p><a:r><a:t>幻灯片内容</a:t></a:r></a:p></p:sld>' });
export function wavFixture() {
  const buffer = Buffer.alloc(44 + 8000); buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34); buffer.write("data", 36); buffer.writeUInt32LE(8000, 40); buffer.fill(128, 44); return buffer;
}
