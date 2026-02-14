"""
Lightweight HTTP server for the Edition Viewer.

Serves the viewer frontend and provides API endpoints for
browsing OCR pipeline output (edition.json files).

Usage:
    python viewer.py [port]

Default port is 8080. Binds to 127.0.0.1 (localhost only).
"""

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
VIEWER_HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "viewer.html")


class ViewerHandler(SimpleHTTPRequestHandler):

    def do_GET(self):
        path = unquote(self.path)

        if path == "/" or path == "/index.html":
            self._serve_file(VIEWER_HTML, "text/html")
        elif path == "/api/editions":
            self._serve_editions_list()
        elif path.startswith("/api/editions/") and path.endswith("/edition.json"):
            self._serve_edition_json(path)
        elif path.startswith("/editions/") and "/images/" in path:
            self._serve_image(path)
        else:
            self.send_error(404)

    def _serve_file(self, filepath, content_type):
        try:
            with open(filepath, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error(404)

    def _serve_editions_list(self):
        editions = []
        if os.path.isdir(OUTPUT_DIR):
            for name in sorted(os.listdir(OUTPUT_DIR), reverse=True):
                edition_dir = os.path.join(OUTPUT_DIR, name)
                json_file = os.path.join(edition_dir, "edition.json")
                if os.path.isdir(edition_dir) and os.path.isfile(json_file):
                    # Read just enough to get metadata
                    try:
                        with open(json_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        editions.append({
                            "date": data.get("edition_date", name),
                            "publication_info": data.get("publication_info", ""),
                            "article_count": len(data.get("articles", [])),
                            "ad_count": len(data.get("ads", [])),
                        })
                    except (json.JSONDecodeError, OSError):
                        continue
        self._send_json(editions)

    def _serve_edition_json(self, path):
        # /api/editions/<date>/edition.json -> output/<date>/edition.json
        parts = path.split("/")
        # parts: ['', 'api', 'editions', '<date>', 'edition.json']
        if len(parts) != 5:
            self.send_error(404)
            return
        date = parts[3]
        # Prevent directory traversal
        if ".." in date or "/" in date:
            self.send_error(403)
            return
        filepath = os.path.join(OUTPUT_DIR, date, "edition.json")
        self._serve_file(filepath, "application/json")

    def _serve_image(self, path):
        # /editions/<date>/images/<filename> -> output/<date>/images/<filename>
        parts = path.split("/")
        # parts: ['', 'editions', '<date>', 'images', '<filename>']
        if len(parts) != 5:
            self.send_error(404)
            return
        date = parts[2]
        filename = parts[4]
        # Prevent directory traversal
        if ".." in date or ".." in filename or "/" in filename:
            self.send_error(403)
            return
        filepath = os.path.join(OUTPUT_DIR, date, "images", filename)
        # Resolve and verify the path stays within OUTPUT_DIR
        real_path = os.path.realpath(filepath)
        if not real_path.startswith(os.path.realpath(OUTPUT_DIR)):
            self.send_error(403)
            return
        ext = os.path.splitext(filename)[1].lower()
        content_types = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }
        content_type = content_types.get(ext, "application/octet-stream")
        self._serve_file(filepath, content_type)

    def _send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Quieter logging — just method + path
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("127.0.0.1", port), ViewerHandler)
    print(f"Edition Viewer running at http://127.0.0.1:{port}")
    print(f"Serving editions from {OUTPUT_DIR}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
