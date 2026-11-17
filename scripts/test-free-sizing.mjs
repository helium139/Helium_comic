import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeViews} from './review-free-sizing.mjs';
test('write model counts indexes once and distinguishes actual expired keys from pessimistic cleanup',()=>{
 const guest=sizeViews({S:6916,R:3287,pStart:0}),auth=sizeViews({S:6916,R:3287,pStart:1});
 assert.deepEqual(guest.writesWithAssumedReserve,[52387,76080]);assert.deepEqual(auth.writesWithAssumedReserve,[65877,103060]);
 assert.deepEqual(sizeViews({S:13832,R:6574}).writesWithAssumedReserve,[99773,147159]);assert.deepEqual(sizeViews({S:13832,R:6574,pStart:1}).writesWithAssumedReserve,[126753,201119]);
 assert.equal(sizeViews({S:6916,R:3287,rateDeletes:0,dedupDeletes:0,sharedWrites:1000,sharedReads:3000}).writesIfExpiredKeysKnown,53387);
 assert.equal(guest.sharedWritesVerified,false);assert.equal(guest.remainingReadQuota,null);
 // All rejected/duplicate attempts still consume receipt writes; no claim A=HTTP200.
 assert.equal(sizeViews({S:1,R:1,A:0,reserve:0,reportWrites:0}).foregroundWrites,4);
});
