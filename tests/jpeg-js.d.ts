declare module 'jpeg-js' {
  interface RawImage {
    data: Uint8Array | Buffer;
    width: number;
    height: number;
  }

  interface EncodedImage {
    data: Buffer;
    width: number;
    height: number;
  }

  const jpeg: {
    encode(image: RawImage, quality?: number): EncodedImage;
  };
  export default jpeg;
}
