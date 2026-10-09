import asyncio
import httpx
import xml.etree.ElementTree as ET
from typing import Any

async def fetch_scholarly_papers(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    papers = []
    headers = {"User-Agent": "HackEval-Evaluator/1.0 (mailto:evaluation@hackeval.local)"}
    
    async with httpx.AsyncClient(headers=headers, timeout=10.0, follow_redirects=True) as client:
        # 1. Query CrossRef (covers IEEE, Springer, ACM)
        try:
            cr_url = "https://api.crossref.org/works"
            params = {"query": f"{query} IEEE", "rows": max_results, "select": "title,container-title,author,URL,published"}
            resp = await client.get(cr_url, params=params)
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("message", {}).get("items", []):
                    title = (item.get("title") or [""])[0].strip()
                    venue = (item.get("container-title") or ["IEEE / Academic Venue"])[0].strip()
                    authors = ", ".join(
                        f"{a.get('given', '')} {a.get('family', '')}".strip()
                        for a in item.get("author", [])[:3]
                    )
                    url = item.get("URL", "")
                    year = "2024"
                    date_parts = item.get("published", {}).get("date-parts", [[]])[0]
                    if date_parts:
                        year = str(date_parts[0])
                    if title:
                        papers.append({
                            "title": title,
                            "source": "IEEE / CrossRef",
                            "venue": venue,
                            "authors": authors or "Researchers",
                            "year": year,
                            "url": url,
                            "summary": f"Published in {venue} ({year}). Focuses on {title.lower()}."
                        })
        except Exception as e:
            print("CrossRef error:", e)

        # 2. Query arXiv (covers modern AI/ML, Quantum, CV)
        try:
            arxiv_url = "http://export.arxiv.org/api/query"
            params = {"search_query": f"all:{query}", "start": 0, "max_results": max_results}
            resp = await client.get(arxiv_url, params=params)
            if resp.status_code == 200:
                root = ET.fromstring(resp.text)
                for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
                    title = (entry.find("{http://www.w3.org/2005/Atom}title").text or "").strip().replace("\n", " ")
                    summary = (entry.find("{http://www.w3.org/2005/Atom}summary").text or "").strip().replace("\n", " ")
                    url = entry.find("{http://www.w3.org/2005/Atom}id").text.strip()
                    published = entry.find("{http://www.w3.org/2005/Atom}published").text[:4]
                    papers.append({
                        "title": title,
                        "source": "arXiv / Google Scholar",
                        "venue": f"arXiv:{published}",
                        "authors": "arXiv Authors",
                        "year": published,
                        "url": url,
                        "summary": summary[:300] + "..."
                    })
        except Exception as e:
            print("arXiv error:", e)

    return papers

async def main():
    papers = await fetch_scholarly_papers("crop disease early stress classical CNN vs quantum")
    print(f"Total papers retrieved: {len(papers)}")
    for i, p in enumerate(papers[:5], 1):
        print(f"\n[{i}] {p['title']}")
        print(f"    Source: {p['source']} | Venue: {p['venue']} | Year: {p['year']}")
        print(f"    URL: {p['url']}")
        print(f"    Summary: {p['summary'][:120]}...")

if __name__ == "__main__":
    asyncio.run(main())
