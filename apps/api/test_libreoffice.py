import asyncio
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from app.rendering.slide_renderer import convert_pptx_to_pdf_bytes, rasterize_page_to_png
import pymupdf

async def main():
    p = Path(r"C:\Users\ASUS\Downloads\RIT - Quantathan 2026 - PPT (3).pptx")
    print(f"Reading {p} ({p.stat().st_size} bytes)...")
    pptx_bytes = p.read_bytes()
    print("Calling convert_pptx_to_pdf_bytes...")
    pdf_bytes = await convert_pptx_to_pdf_bytes(pptx_bytes)
    print(f"Converted to PDF! Size: {len(pdf_bytes)} bytes")
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
        print(f"Total pages: {pdf.page_count}")
        for i in range(pdf.page_count):
            png = rasterize_page_to_png(pdf_bytes, i)
            print(f"Slide {i+1} PNG size: {len(png)} bytes")

if __name__ == "__main__":
    asyncio.run(main())
