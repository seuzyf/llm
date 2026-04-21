import sys
import os

# 安全地设置 UTF-8 编码，避免重复包裹导致底层流被关闭
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from parsers import (
    parse_email, parse_pdf, parse_word, parse_ppt, 
    parse_excel, parse_html_xml, parse_rtf, parse_epub, parse_plain_text
)

def parse_file_to_text(file_path, display_name=None):
    """通用解析管道：返回提取出的纯文本或 Markdown"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    actual_name = display_name or os.path.basename(file_path)
    ext = os.path.splitext(actual_name)[1].lower()

    # 二进制文件拦截
    binary_exts = [
        '.exe', '.dll', '.so', '.bin',
        '.zip', '.rar', '.7z', '.tar', '.gz',
        '.jpg', '.jpeg', '.png', '.gif',
        '.mp3', '.mp4',
    ]
    if ext in binary_exts:
        raise ValueError(f"暂不支持解析媒体或二进制文件: {ext}")

    # 分发到对应的解析器
    if ext in ['.eml', '.msg']:
        # 传递当前函数作为 callback 以实现邮件附件的递归解析
        return parse_email(file_path, actual_name, parse_callback=parse_file_to_text)
    elif ext == '.pdf':
        return parse_pdf(file_path)
    elif ext in ['.docx', '.doc']:
        return parse_word(file_path)
    elif ext in ['.pptx', '.ppt']:
        return parse_ppt(file_path, actual_name, parse_callback=parse_file_to_text)
    elif ext in ['.xlsx', '.xls', '.csv']:
        return parse_excel(file_path, actual_name)
    elif ext in ['.html', '.htm', '.xml']:
        return parse_html_xml(file_path)
    elif ext == '.rtf':
        return parse_rtf(file_path)
    elif ext == '.epub':
        return parse_epub(file_path)
    else:
        return parse_plain_text(file_path)

def process_path(path):
    """处理单个文件或遍历文件夹"""
    if os.path.isfile(path):
        try:
            result = parse_file_to_text(path)
            if result:
                print(result)
        except Exception as e:
            sys.stderr.write(f"解析异常 [{path}]: {str(e)}\n")
    elif os.path.isdir(path):
        print(f"## 📁 文件夹：{path}\n")
        for root, _, files in os.walk(path):
            for file in files:
                file_path = os.path.join(root, file)
                # 过滤掉无法处理的文件，提高效率
                if file.startswith('.') or file.startswith('~'):
                    continue
                print(f"\n{'='*60}\n📄 文件: {file_path}\n{'='*60}")
                try:
                    result = parse_file_to_text(file_path)
                    if result:
                        print(result)
                except Exception as e:
                    print(f"❌ 解析跳过: {str(e)}")
    else:
        sys.stderr.write(f"路径无效: {path}\n")

def parse():
    if len(sys.argv) < 2:
        print("❌ 使用方式错误。请输入文件或文件夹路径。")
        sys.exit(1)
    
    input_path = sys.argv[1]
    process_path(input_path)

if __name__ == "__main__":
    parse()
