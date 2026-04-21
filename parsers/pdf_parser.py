def parse_pdf(file_path):
    from pypdf import PdfReader
    reader = PdfReader(file_path)
    return "\n".join([p.extract_text() for p in reader.pages if p.extract_text()])