import sharp from 'sharp';

export const computePHash = async (imageBuffer: Buffer): Promise<string> => {
  try {
    const { data } = await sharp(imageBuffer)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = Array.from(data);
    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;

    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += pixels[i] >= avg ? '1' : '0';
    }

    return BigInt(`0b${hash}`).toString(16).padStart(16, '0');
  } catch (error) {
    console.error('Error computing pHash:', error);
    throw error;
  }
};

export const hammingDistance = (hash1: string, hash2: string): number => {
  const bigint1 = BigInt(`0x${hash1}`);
  const bigint2 = BigInt(`0x${hash2}`);
  let xor = bigint1 ^ bigint2;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
};

export const isSimilarImage = (hash1: string, hash2: string, threshold = 5): boolean => {
  return hammingDistance(hash1, hash2) <= threshold;
};
