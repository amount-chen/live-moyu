const MAX = 65536;
function encode(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (!body.length || body.length > MAX) throw new Error('Message too large');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
function decoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (!length || length > MAX) throw new Error('Invalid frame');
      if (buffer.length < 4 + length) break;
      const body = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
      onMessage(JSON.parse(body.toString('utf8')));
    }
  };
}
module.exports = {encode, decoder};
