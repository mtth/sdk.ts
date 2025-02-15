#!/usr/bin/env node

import benchmark from 'benchmark';
import crypto from 'crypto';

import {intensive} from '../lib/intensive.js';

const sentinel = Symbol('sentinel');

function touch(val) {
  if (val === sentinel) {
    throw new Error();
  }
}

const HASH_LENGTH = 64;
const SALT_LENGTH = 16;

const salt = crypto.randomBytes(SALT_LENGTH);

function work(cost = 2) {
  const uuid = crypto.randomUUID();
  return crypto.scryptSync(uuid, salt, HASH_LENGTH, {cost});
}

const LOOP_LENGTH = 1000;

function operation() {
  return intensive(function* () {
    for (let ix = 0; ix < LOOP_LENGTH; ix++) {
      touch(work());
      yield;
    }
  });
}

const suite = new benchmark.Suite()
  .add('work once', () => {
    touch(work());
  })
  .add('inline', () => {
    for (let ix = 0; ix < LOOP_LENGTH; ix++) {
      touch(work());
    }
  })
  .add('intensive sync', () => {
    operation().runSync();
  })
  .add('intensive async', {
    defer: true,
    fn: (done) => void operation().run().finally(() => done.resolve())
  })
  .on('cycle', (ev) => {
    console.log(String(ev.target));
  })
  .run({async: true});
