#!/usr/bin/env node

import {intensive} from '@mtth/stl-utils/intensive';
import benchmark from 'benchmark';
import crypto from 'crypto';

import {appTelemetry} from '../lib/index.js';

const telemetry = appTelemetry({name: 'benchmark'});

const sentinel = Symbol('sentinel');

function touch(val) {
  if (val === sentinel) {
    throw new Error();
  }
}

const HASH_LENGTH = 64;
const SALT_LENGTH = 16;

const salt = crypto.randomBytes(SALT_LENGTH);

function work(cost = 4) {
  const uuid = crypto.randomUUID();
  return crypto.scryptSync(uuid, salt, HASH_LENGTH, {cost});
}

const LOOP_LENGTH = 500;

function embeddedOperation() {
  return intensive(function* () {
    for (let ix = 0; ix < LOOP_LENGTH; ix++) {
      touch(work());
      yield;
    }
  });
}

function rootOperation() {
  return intensive(function* (embed) {
    yield* embed(embeddedOperation());
    yield* embed(embeddedOperation());
  });
}

function tracedRootOperation(fwd) {
  return telemetry.withActiveSpan(
    {name: 'root', forwardIntensiveSpan: fwd},
    rootOperation
  );
}

const suite = new benchmark.Suite()
  .add('work once', () => {
    touch(work());
  })
  .add('untraced intensive sync', () => {
    rootOperation().runSync();
  })
  .add('untraced intensive async', {
    defer: true,
    fn: (done) => void rootOperation().run().finally(() => done.resolve())
  })
  .add('traced intensive sync', () => {
    tracedRootOperation().runSync();
  })
  .add('traced intensive async', {
    defer: true,
    fn: (done) => void tracedRootOperation().run().finally(() => done.resolve())
  })
  .add('traced intensive sync forwarding', () => {
    tracedRootOperation(true).runSync();
  })
  .add('traced intensive async forwarding', {
    defer: true,
    fn: (done) => void tracedRootOperation(true).run().finally(() => done.resolve())
  })
  .on('cycle', (ev) => {
    console.log(String(ev.target));
  })
  .run({async: true});
