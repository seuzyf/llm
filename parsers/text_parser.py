def parse_html_xml(file_path):
    from bs4 import BeautifulSoup
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')
        return soup.get_text(separator='\n', strip=True)

def parse_rtf(file_path):
    from striprtf.striprtf import rtf_to_text
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        return rtf_to_text(f.read())

def parse_epub(file_path):
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup
    book = epub.read_epub(file_path)
    texts = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_body_content(), 'html.parser')
        texts.append(soup.get_text(separator='\n', strip=True))
    return "\n".join(texts)

def parse_plain_text(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        with open(file_path, 'r', encoding='gbk', errors='ignore') as f:
            return f.read()