import urllib.request
import urllib.parse
import json

def test_crossref_and_openalex():
    query = "crop disease detection convolutional neural network"
    # Query OpenAlex specifically for IEEE or computer vision / agriculture
    url_alex = f"https://api.openalex.org/works?search={urllib.parse.quote(query)}&filter=default.search:IEEE&per-page=3"
    req_alex = urllib.request.Request(url_alex, headers={"User-Agent": "HackEval/1.0 (mailto:dev@hackeval.local)"})
    try:
        with urllib.request.urlopen(req_alex, timeout=8) as res:
            data = json.loads(res.read().decode())
            print("=== OpenAlex IEEE Results ===")
            for w in data.get("results", []):
                venue = (w.get("primary_location") or {}).get("source", {}).get("display_name", "Academic Venue")
                print("Title:", w.get("title"))
                print(f"Year: {w.get('publication_year')}, Venue: {venue}, Citations: {w.get('cited_by_count')}")
                print(f"URL: {w.get('doi') or w.get('id')}\n")
    except Exception as e:
        print("OpenAlex error:", e)

    # CrossRef API for IEEE papers
    url_cr = f"https://api.crossref.org/works?query={urllib.parse.quote(query + ' IEEE')}&rows=3"
    req_cr = urllib.request.Request(url_cr, headers={"User-Agent": "HackEval/1.0 (mailto:dev@hackeval.local)"})
    try:
        with urllib.request.urlopen(req_cr, timeout=8) as res:
            data = json.loads(res.read().decode())
            print("=== CrossRef IEEE Results ===")
            for item in data.get("message", {}).get("items", []):
                title = (item.get("title") or ["No Title"])[0]
                container = (item.get("container-title") or ["Unknown Venue"])[0]
                year = item.get("created", {}).get("date-parts", [[2023]])[0][0]
                doi_url = item.get("URL", "")
                print(f"Title: {title}\nVenue: {container} ({year})\nURL: {doi_url}\n")
    except Exception as e:
        print("CrossRef error:", e)

if __name__ == "__main__":
    test_crossref_and_openalex()
