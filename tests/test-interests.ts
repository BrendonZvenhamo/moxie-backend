import { normalizeInterest } from '../src/utils/interests';

const testInterests = [
  'sports',
  'gaming',
  'tech',
  'music',
  'football',
  'coding',
  'pizza'
];

console.log('--- Interest Normalization Test ---');
testInterests.forEach(i => {
  const result = normalizeInterest(i);
  console.log(`Input: ${i.padEnd(10)} | Cluster: ${result.cluster?.padEnd(20)} | Method: ${result.method}`);
});

if (normalizeInterest('sports').cluster === 'sports_cluster' && normalizeInterest('tech').cluster === 'tech_cluster') {
  console.log('\n✅ PASS: New category aliases mapped correctly.');
} else {
  console.log('\n❌ FAIL: New category aliases NOT mapped correctly.');
  process.exit(1);
}
