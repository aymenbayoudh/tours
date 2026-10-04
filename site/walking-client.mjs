// At most one calculation in flight. Replacing pending requests prevents a
// pointer drag from queuing obsolete origins behind the latest position.
export class WalkingClient {
  constructor(worker, onResult, onReady, onError) {
    this.worker = worker;
    this.ready = false;
    this.busy = false;
    worker.onmessage = ({data}) => {
      if (data.type === 'ready') { this.ready = true; onReady(); this.flush(); }
      if (data.type === 'result') { this.busy = false; onResult(data.result); this.flush(); }
      if (data.type === 'error') { this.busy = false; this.failed = true; onError(data.message); }
    };
    worker.onerror = event => { this.failed = true; this.busy = false; onError(event.message); };
  }
  request(request) {
    if (this.failed || request.key === this.lastKey) return;
    this.lastKey = request.key;
    this.pending = request;
    this.flush();
  }
  flush() {
    if (!this.ready || this.busy || !this.pending || this.failed) return;
    const request = this.pending;
    this.pending = null;
    this.busy = true;
    this.worker.postMessage({type: 'calculate', request});
  }
}
