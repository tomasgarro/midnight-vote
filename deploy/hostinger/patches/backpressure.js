// Flow control for the wallet's push-based indexer transport. No events are dropped.
export function createSocketBackpressure(high = 16, low = 8) {
  if (!Number.isInteger(high) || !Number.isInteger(low) || low < 0 || low >= high) {
    throw new Error('Invalid socket backpressure thresholds');
  }
  let socket;
  let pending = 0;
  let paused = false;
  const update = () => {
    if (!socket) return;
    if (!paused && pending >= high) { socket.pause(); paused = true; }
    else if (paused && pending <= low) { socket.resume(); paused = false; }
  };
  return {
    setSocket(next) {
      if (paused && socket !== next) socket.resume();
      socket = next;
      paused = false;
      update();
    },
    push(send) {
      pending++;
      update();
      const release = () => { pending--; update(); };
      try { return Promise.resolve(send()).then(value => { release(); return value; }, error => { release(); throw error; }); }
      catch (error) { release(); return Promise.reject(error); }
    },
    get pending() { return pending; },
  };
}
