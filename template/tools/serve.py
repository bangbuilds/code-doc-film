#!/usr/bin/env python3
"""Static preview server that never lets the browser cache anything.

python3's http.server sends no cache headers, so the browser keeps serving stale ES modules
after you edit them — you fix a bug and the page still shows the old one. Use this instead:

    python3 tools/serve.py [port] [directory]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    ThreadingHTTPServer(('127.0.0.1', port), partial(NoCache, directory=directory)).serve_forever()
