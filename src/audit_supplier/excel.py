import pandas as pd
import os
import sys
import io
import email

try:
    import extract_msg
except ImportError:
    extract_msg = None

# 安全地设置 UTF-8 编码，避免重复包裹导致底层流被关闭
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def format_df_to_md(df, file_name, file_path_info):
    """将 DataFrame 转换为结构化 Markdown"""
    df_clean = df.fillna("").astype(str)
    
    if df_clean.empty:
        return f"### 📄 {file_name}\n⚠️ 该表格内容为空。\n"

    md_lines = [f"### 📄 {file_name}", ""]
    
    header = "| " + " | ".join([str(col) for col in df_clean.columns]) + " |"
    separator = "| " + " | ".join(["---"] * len(df_clean.columns)) + " |"
    md_lines.append(header)
    md_lines.append(separator)
    
    for _, row in df_clean.iterrows():
        row_str = "| " + " | ".join([str(cell).replace("\n", " ") for cell in row]) + " |"
        md_lines.append(row_str)
    
    md_lines.append("")
    md_lines.append(f"📂 来源：{file_path_info} | 📊 行数：{len(df_clean)} | 列数：{len(df_clean.columns)}")
    md_lines.append("\n---")
    
    return "\n".join(md_lines)

def extract_excels_from_email(file_path):
    """从邮件中提取表格附件并解析，如果没有表格则兜底提取全部内容"""
    ext = os.path.splitext(file_path)[1].lower()
    md_outputs = []
    
    if ext == '.eml':
        with open(file_path, 'rb') as f:
            msg = email.message_from_binary_file(f)
        for part in msg.walk():
            if part.get_content_maintype() == 'multipart' or part.get('Content-Disposition') is None:
                continue
            filename = part.get_filename()
            if filename and filename.lower().endswith(('.xls', '.xlsx', '.xlsm', '.xlsb', '.csv')):
                payload = part.get_payload(decode=True)
                try:
                    if filename.lower().endswith('.csv'):
                        df = pd.read_csv(io.BytesIO(payload))
                    elif filename.lower().endswith('.xls'):
                        df = pd.read_excel(io.BytesIO(payload), engine="xlrd")
                    else:
                        df = pd.read_excel(io.BytesIO(payload), engine="openpyxl")
                    md_outputs.append(format_df_to_md(df, filename, f"邮件附件 ({os.path.basename(file_path)})"))
                except Exception as e:
                    md_outputs.append(f"❌ 邮件附件提取失败 [{filename}]：{str(e)}")

    elif ext == '.msg':
        if extract_msg is None:
            return "❌ 错误：缺少 extract-msg 库。请执行 `pip install extract-msg`"
        msg = extract_msg.Message(file_path)
        for attachment in msg.attachments:
            filename = attachment.longFilename or attachment.shortFilename
            if filename and filename.lower().endswith(('.xls', '.xlsx', '.xlsm', '.xlsb', '.csv')):
                payload = attachment.data
                try:
                    if filename.lower().endswith('.csv'):
                        df = pd.read_csv(io.BytesIO(payload))
                    elif filename.lower().endswith('.xls'):
                        df = pd.read_excel(io.BytesIO(payload), engine="xlrd")
                    else:
                        df = pd.read_excel(io.BytesIO(payload), engine="openpyxl")
                    md_outputs.append(format_df_to_md(df, filename, f"邮件附件 ({os.path.basename(file_path)})"))
                except Exception as e:
                    md_outputs.append(f"❌ 邮件附件提取失败 [{filename}]：{str(e)}")
                    
    # 如果没有找到任何表格附件，触发兜底逻辑调用 parser.py
    if not md_outputs:
        try:
            import importlib.util
            
            # 当前文件所在目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            
            # 定义查找候选列表
            candidate_paths = [
                # 1. 精确向上两层目录寻找
                os.path.abspath(os.path.join(current_dir, "../../parser.py")),
                # 2. Node.js 运行的工作目录（通常是项目根目录）寻找
                os.path.join(os.getcwd(), "parser.py"),
                # 3. 如果是用编译后的 dist 目录运行，可能需要向上三层
                os.path.abspath(os.path.join(current_dir, "../../../parser.py"))
            ]
            
            parser_path = None
            checked_paths = []
            
            for p in candidate_paths:
                checked_paths.append(p)
                if os.path.exists(p):
                    parser_path = p
                    break
            
            if parser_path:
                # 动态导入找到的 parser.py
                spec = importlib.util.spec_from_file_location("custom_parser", parser_path)
                custom_parser = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(custom_parser)
                
                # 调用 parser.py 中的通用解析方法
                fallback_text = custom_parser.parse_file_to_text(file_path)
                return f"⚠️ 邮件 [{os.path.basename(file_path)}] 中未找到表格附件。已自动兜底提取正文及其他附件：\n\n{fallback_text}"
            else:
                paths_str = "\n".join([f" - {p}" for p in set(checked_paths)])
                return f"⚠️ 邮件 [{os.path.basename(file_path)}] 中未找到表格附件，且无法找到 parser.py 兜底解析。已尝试以下路径：\n{paths_str}"
                
        except Exception as e:
            return f"⚠️ 邮件 [{os.path.basename(file_path)}] 中未找到表格附件，兜底解析发生异常：{str(e)}"
    
    return "\n".join(md_outputs)

def read_single_excel(file_path):
    """核心功能：无乱码读取单个中文 Excel（包含邮件中的附件）"""
    if not os.path.exists(file_path):
        return f"❌ 错误：文件不存在 → {file_path}"
    
    ext = file_path.lower()
    
    # 拦截邮件格式
    if ext.endswith(('.eml', '.msg')):
        return extract_excels_from_email(file_path)
    
    try:
        if ext.endswith(".xlsx"):
            df = pd.read_excel(file_path, engine="openpyxl")
        elif ext.endswith(".xls"):
            import xlrd
            xls_book = xlrd.open_workbook(file_path, formatting_info=False)
            xls_sheet = xls_book.sheet_by_index(0)
            data = []
            for i in range(xls_sheet.nrows):
                row = xls_sheet.row_values(i)
                data.append(row)
            df = pd.DataFrame(data[1:], columns=data[0]) if data else pd.DataFrame()
        elif ext.endswith(".csv"):
             for enc in ['utf-8', 'gbk', 'gb2312']:
                 try:
                     df = pd.read_csv(file_path, encoding=enc)
                     break
                 except UnicodeDecodeError:
                     continue
        else:
            return f"❌ 错误：仅支持 表格或邮件 格式 → {file_path}"
        
        return format_df_to_md(df, os.path.basename(file_path), file_path)
    except Exception as e:
        return f"❌ 文件读取失败 [{file_path}]：{str(e)}"
    
def traverse_folder(folder_path):
    if not os.path.isdir(folder_path):
        return f"❌ 错误：不是有效文件夹 → {folder_path}"
    
    target_files = []
    for file_name in os.listdir(folder_path):
        if file_name.lower().endswith((".xlsx", ".xls", ".csv", ".eml", ".msg")):
            target_files.append(os.path.join(folder_path, file_name))
    
    if not target_files:
        return f"⚠️ 文件夹 [{folder_path}] 下未找到任何目标文件"
    
    folder_output = [f"## 📁 文件夹：{folder_path}（共 {len(target_files)} 个文件）\n"]
    for file in target_files:
        file_output = read_single_excel(file)
        folder_output.append(file_output)
    
    return "\n".join(folder_output)

def main():
    if len(sys.argv) < 2:
        print("❌ 使用方式错误。请输入 Excel 或 邮件 文件路径。")
        sys.exit(1)
    
    input_path = sys.argv[1]
    
    print("\n" + "="*60)
    print("📊 正在提取内容...")
    print("="*60 + "\n")

    if os.path.isfile(input_path):
        result = read_single_excel(input_path)
    elif os.path.isdir(input_path):
        result = traverse_folder(input_path)
    else:
        result = f"❌ 错误：路径不存在 → {input_path}"
    
    print(result)
    print("\n" + "="*60)
    print("✅ 内容提取完成")
    print("="*60)

if __name__ == "__main__":
    main()
