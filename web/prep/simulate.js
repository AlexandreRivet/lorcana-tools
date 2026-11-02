// Runs the tournament simulation off the page's thread: posts { done } as it goes, then { counts }
import { simulate } from '../../src/lib/forecast.js';

self.onmessage = ({ data }) => {
  const counts = simulate(data, (done) => self.postMessage({ done }));
  self.postMessage({ counts });
};
