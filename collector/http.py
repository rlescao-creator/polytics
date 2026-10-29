import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "poll-collector/0.1 (election polls vs prediction markets research)"


def get(url, params=None, retries=4, delay=0.3, user_agent=USER_AGENT, timeout=60):
    """GET avec retry exponentiel sur 429/5xx, et une pause de politesse après chaque appel.

    Un corps gzip (sitemaps .xml.gz, pages servies telles quelles par la Wayback Machine) est décompressé.
    """
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            time.sleep(delay)
            return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)


def get_json(url, params=None):
    return json.loads(get(url, params))
