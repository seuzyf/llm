# parser.py
import sys
import os
import io

# 强制设置输出编码为 UTF-8，防止 Windows 环境中文乱码，加入 errors='replace' 增强鲁棒性
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def parse():
    if len(sys.argv) < 2:
        return
    
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        sys.stderr.write(f"文件不存在: {file_path}")
        sys.exit(1)

    ext = os.path.splitext(file_path)[1].lower()
    
    try:
        # 1. PDF 解析
        if ext == '.pdf':
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            print("\n".join([p.extract_text() for p in reader.pages if p.extract_text()]))
            
        # 2. Word 解析 (.docx 与 老版 .doc)
        elif ext == '.docx':
            from docx import Document
            doc = Document(file_path)
            print("\n".join([p.text for p in doc.paragraphs]))
        elif ext == '.doc':
            try:
                import win32com.client
                word = win32com.client.Dispatch("Word.Application")
                word.Visible = False
                abs_path = os.path.abspath(file_path)
                doc = word.Documents.Open(abs_path)
                text = doc.Content.Text
                doc.Close()
                word.Quit()
                print(text)
            except Exception as e:
                sys.stderr.write(f"读取 .doc 失败 (需要 Windows 安装了 Word 及 pywin32): {str(e)}")
                sys.exit(1)
                
        # 3. PPT 解析 (.pptx 与 老版 .ppt)
        elif ext == '.pptx':
            from pptx import Presentation
            prs = Presentation(file_path)
            text_runs = []
            for slide in prs.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text"):
                        text_runs.append(shape.text)
            print("\n".join(text_runs))
        elif ext == '.ppt':
            try:
                import win32com.client
                powerpoint = win32com.client.Dispatch("PowerPoint.Application")
                abs_path = os.path.abspath(file_path)
                prs = powerpoint.Presentations.Open(abs_path, WithWindow=False)
                text_runs = []
                for slide in prs.Slides:
                    for shape in slide.Shapes:
                        if shape.HasTextFrame and shape.TextFrame.HasText:
                            text_runs.append(shape.TextFrame.TextRange.Text)
                prs.Close()
                powerpoint.Quit()
                print("\n".join(text_runs))
            except Exception as e:
                sys.stderr.write(f"读取 .ppt 失败 (需要 Windows 安装了 PowerPoint 及 pywin32): {str(e)}")
                sys.exit(1)
                
        # 4. 表格解析 (.xlsx, .xls, .csv) - 使用 Markdown 表格结构输出
        elif ext in ['.xlsx', '.xls', '.csv']:
            import pandas as pd
            if ext == '.csv':
                # 增强 CSV 编码兼容性
                for enc in ['utf-8', 'gbk', 'utf-16', 'gb2312', 'latin1']:
                    try:
                        df = pd.read_csv(file_path, encoding=enc)
                        break
                    except: continue
            else:
                try:
                    if ext == '.xlsx':
                        df = pd.read_excel(file_path, engine="openpyxl")
                    else:
                        df = pd.read_excel(file_path, engine="xlrd")
                except Exception:
                    df = pd.read_excel(file_path) # 兜底默认引擎
            
            # 清洗数据，填充空值为 ""
            df_clean = df.fillna("").astype(str)
            md_lines = [f"### 📄 表格文件：{os.path.basename(file_path)}", ""]
            
            if df_clean.empty:
                md_lines.append("（空表格）")
            else:
                # 构造表头 (将列名中的换行符替换为空格，防止破坏 Markdown 语法)
                header = "| " + " | ".join([str(col).replace('\n', ' ') for col in df_clean.columns]) + " |"
                separator = "| " + " | ".join(["---"] * len(df_clean.columns)) + " |"
                md_lines.append(header)
                md_lines.append(separator)
                
                # 构造行内容 (将单元格内的换行符替换为 <br>)
                for _, row in df_clean.iterrows():
                    row_str = "| " + " | ".join([str(cell).replace('\n', '<br>') for cell in row]) + " |"
                    md_lines.append(row_str)
            
            # 添加汇总信息
            md_lines.append("")
            md_lines.append(f"📊 统计信息：行数 {len(df_clean)} | 列数 {len(df_clean.columns)}")
            print("\n".join(md_lines))

        # 5. 网页及 XML (.html, .htm, .xml) - 提取纯文本剔除标签
        elif ext in ['.html', '.htm', '.xml']:
            from bs4 import BeautifulSoup
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                soup = BeautifulSoup(f.read(), 'html.parser')
                print(soup.get_text(separator='\n', strip=True))

        # 6. 富文本格式 (.rtf)
        elif ext == '.rtf':
            from striprtf.striprtf import rtf_to_text
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                print(rtf_to_text(f.read()))

        # 7. 电子书格式 (.epub)
        elif ext == '.epub':
            import ebooklib
            from ebooklib import epub
            from bs4 import BeautifulSoup
            book = epub.read_epub(file_path)
            texts = []
            for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
                soup = BeautifulSoup(item.get_body_content(), 'html.parser')
                texts.append(soup.get_text(separator='\n', strip=True))
            print("\n".join(texts))
            
        # 8. 兜底解析 (代码文件, Markdown, txt 等纯文本)
        else:
            # 明确拦截图片、压缩包等非文本二进制文件，防止乱码崩溃
            binary_exts = ['.exe', '.dll', '.so', '.bin', '.zip', '.rar', '.7z', '.tar', '.gz', '.jpg', '.jpeg', '.png', '.gif', '.mp3', '.mp4']
            if ext in binary_exts:
                sys.stderr.write(f"暂不支持解析此二进制或媒体文件: {ext}")
                sys.exit(1)
                
            # 尝试以文本方式读取，加入忽略错误机制增强鲁棒性
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    print(f.read())
            except UnicodeDecodeError:
                with open(file_path, 'r', encoding='gbk', errors='ignore') as f:
                    print(f.read())
                    
    except Exception as e:
        sys.stderr.write(f"解析异常: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    parse()
