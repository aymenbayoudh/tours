// Coalesce pointer positions rather than accumulating obsolete computations.
export class DirectClient {
  constructor(worker, onResult, onError) {
    this.worker = worker;
    this.ready = false; this.busy = false; this.failed = false;
    worker.onmessage = ({data}) => {
      if (data.type === 'ready') { this.ready = true; this.flush(); }
      else if (data.type === 'result') { this.busy = false; onResult(data.result); this.flush(); }
      else if (data.type === 'error') this.fail(data.message, onError);
    };
    worker.onerror = event => this.fail(event.message, onError);
  }
  fail(message, onError) { this.failed = true; this.busy = false; this.pending = null; onError(message); }
  request(request) {
    if (this.failed || request.key === this.lastKey) return;
    this.lastKey = request.key; this.pending = request; this.flush();
  }
  flush() {
    if (!this.ready || this.busy || !this.pending || this.failed) return;
    const request = this.pending; this.pending = null; this.busy = true;
    this.worker.postMessage({type:'calculate', request});
  }
}
