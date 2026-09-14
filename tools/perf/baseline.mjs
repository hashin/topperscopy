/* Run the whole harness and print one comparable block.
   Run this BEFORE and AFTER every phase and paste both into the commit message. */
import { execFileSync } from 'node:child_process';
import { ROOT } from './_lib.mjs';
const steps = [
  ['sizes.mjs', []], ['sortbench.mjs', []],
  ['measure.mjs', ['4g']], ['measure.mjs', ['3g']],
  ['cls.mjs', ['3g']], ['a11y.mjs', []], ['fold.mjs', []],
  ['showmore.mjs', []], ['lost-keystroke.mjs', []]
];
console.log('Toppers Copy — perf baseline · ' + new Date().toISOString());
try { console.log('commit: ' + execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()); } catch (e) {}
for (const [script, args] of steps) {
  console.log('\n' + '='.repeat(72));
  console.log('$ node tools/perf/' + script + (args.length ? ' ' + args.join(' ') : ''));
  console.log('='.repeat(72));
  try {
    console.log(execFileSync(process.execPath, ['tools/perf/' + script, ...args],
      { cwd: ROOT, encoding: 'utf8', timeout: 600000 }));
  } catch (e) {
    console.log('FAILED: ' + (e.stdout || '') + (e.stderr || e.message));
  }
}
