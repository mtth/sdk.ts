import {codecs} from '../common.js';

codecs.base64 = (s: string): any => {
  return JSON.parse(atob(s));
};
