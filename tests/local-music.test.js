const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readTags,filenameTags,mimeFor}=require('../frontend/local-music.js');

test('filename tags preserve a normal title and split artist separators',()=>{
  assert.equal(filenameTags('03 Example — My Song.wav').artist,'Example');
  assert.equal(filenameTags('03 Example — My Song.wav').title,'My Song');
  assert.equal(filenameTags('My Song.flac').title,'My Song');
  assert.equal(mimeFor('TRACK.FLAC'),'audio/flac');
  assert.equal(mimeFor('page.html'),'');
});
function id3Frame(id,text){const body=Buffer.concat([Buffer.from([3]),Buffer.from(text)]),header=Buffer.alloc(10);header.write(id);header.writeUInt32BE(body.length,4);return Buffer.concat([header,body]);}
test('ID3 artist, album and title replace filename guesses',()=>{
  const frames=Buffer.concat([id3Frame('TIT2','Название'),id3Frame('TPE1','Исполнитель'),id3Frame('TALB','Альбом'),id3Frame('TRCK','2/10')]);
  const header=Buffer.alloc(10);header.write('ID3');header[3]=3;header[6]=(frames.length>>>21)&127;header[7]=(frames.length>>>14)&127;header[8]=(frames.length>>>7)&127;header[9]=frames.length&127;
  const file=Buffer.concat([header,frames]);const result=readTags(file.buffer.slice(file.byteOffset,file.byteOffset+file.length),'file.mp3');
  assert.equal(result.title,'Название');assert.equal(result.artist,'Исполнитель');assert.equal(result.album,'Альбом');assert.equal(result.track_number,2);
});
test('truncated or malicious tag lengths leave usable filename metadata',()=>{
  const bytes=Buffer.from('ID3\x03\x00\x00\x7f\x7f\x7f\x7fTIT2\xff\xff\xff\xff\x00\x00');
  assert.equal(readTags(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'Example - Song.mp3').title,'Song');
});
test('FLAC comments provide local album grouping',()=>{
  const values=['TITLE=Song','ARTIST=Example','ALBUM=Record','TRACKNUMBER=3'];
  const comments=Buffer.concat(values.map(value=>{const text=Buffer.from(value),length=Buffer.alloc(4);length.writeUInt32LE(text.length);return Buffer.concat([length,text])}));
  const beginning=Buffer.alloc(8);beginning.writeUInt32LE(values.length,4);const block=Buffer.concat([beginning,comments]),header=Buffer.alloc(4);header[0]=132;header[1]=(block.length>>>16)&255;header[2]=(block.length>>>8)&255;header[3]=block.length&255;
  const file=Buffer.concat([Buffer.from('fLaC'),header,block]);const result=readTags(file.buffer.slice(file.byteOffset,file.byteOffset+file.length),'file.flac');
  assert.equal(result.album,'Record');assert.equal(result.artist,'Example');assert.equal(result.track_number,3);
});
