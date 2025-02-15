/** Name of the codec must match the file's name */
export type InlineCodecName = 'base64' | 'fflate-gzip';

export const codecs: {[name in InlineCodecName]?: (data: string) => unknown} = {};
