function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Dhan feed packet must be a Buffer or ArrayBuffer view');
}

function readHeader(buf) {
  if (buf.length < 8) throw new Error(`Dhan feed packet too short: ${buf.length}`);
  return {
    responseCode: buf.readUInt8(0),
    messageLength: buf.readInt16LE(1),
    exchangeSegmentCode: buf.readUInt8(3),
    securityId: String(buf.readInt32LE(4)),
  };
}

export function decodeFeedPacket(input) {
  const buf = toBuffer(input);
  const header = readHeader(buf);

  if (header.responseCode === 2) {
    if (buf.length < 16) throw new Error('Dhan ticker packet too short');
    return {
      packetType: 'ticker',
      responseCode: header.responseCode,
      exchangeSegmentCode: header.exchangeSegmentCode,
      securityId: header.securityId,
      ltp: Number(buf.readFloatLE(8).toFixed(2)),
      lastTradeTime: buf.readInt32LE(12),
    };
  }

  if (header.responseCode === 6) {
    if (buf.length < 16) throw new Error('Dhan previous-close packet too short');
    return {
      packetType: 'prev_close',
      responseCode: header.responseCode,
      exchangeSegmentCode: header.exchangeSegmentCode,
      securityId: header.securityId,
      prevClose: Number(buf.readFloatLE(8).toFixed(2)),
      previousOpenInterest: buf.readInt32LE(12),
    };
  }

  return {
    packetType: 'unsupported',
    responseCode: header.responseCode,
    exchangeSegmentCode: header.exchangeSegmentCode,
    securityId: header.securityId,
    messageLength: header.messageLength,
  };
}
