import os
import pandas as pd

def format_df_to_md(df, file_name, file_path_info):
    """将 DataFrame 转换为结构化 Markdown"""
    df_clean = df.fillna("").astype(str)
    
    if df_clean.empty:
        return f"### 📄 {file_name}\n⚠️ 该表格内容为空。\n"

    md_lines = [f"### 📄 {file_name}", ""]
    
    header = "| " + " | ".join([str(col).replace("\n", " ") for col in df_clean.columns]) + " |"
    separator = "| " + " | ".join(["---"] * len(df_clean.columns)) + " |"
    md_lines.append(header)
    md_lines.append(separator)
    
    for _, row in df_clean.iterrows():
        row_str = "| " + " | ".join([str(cell).replace("\n", "<br>") for cell in row]) + " |"
        md_lines.append(row_str)
    
    md_lines.append("")
    md_lines.append(f"📂 来源：{file_path_info} | 📊 行数：{len(df_clean)} | 列数：{len(df_clean.columns)}")
    md_lines.append("\n---")
    
    return "\n".join(md_lines)

def parse_excel(file_path, display_name):
    """解析 Excel/CSV 并输出为 Markdown 表格"""
    ext = os.path.splitext(display_name)[1].lower()
    md_outputs = []
    
    try:
        if ext == ".xlsx":
            # 开启 sheet_name=None 以读取所有 sheet
            dfs = pd.read_excel(file_path, engine="openpyxl", sheet_name=None)
            for sheet_name, df in dfs.items():
                md_outputs.append(format_df_to_md(df, f"{display_name} - {sheet_name}", display_name))
                
        elif ext == ".xls":
            import xlrd
            xls_book = xlrd.open_workbook(file_path, formatting_info=False)
            for sheet_idx in range(xls_book.nsheets):
                xls_sheet = xls_book.sheet_by_index(sheet_idx)
                data = []
                for i in range(xls_sheet.nrows):
                    data.append(xls_sheet.row_values(i))
                
                if data:
                    df = pd.DataFrame(data[1:], columns=data[0])
                    md_outputs.append(format_df_to_md(df, f"{display_name} - {xls_sheet.name}", display_name))
                else:
                    md_outputs.append(format_df_to_md(pd.DataFrame(), f"{display_name} - {xls_sheet.name}", display_name))
                    
        elif ext == ".csv":
             for enc in ['utf-8', 'gbk', 'gb2312', 'latin1']:
                 try:
                     df = pd.read_csv(file_path, encoding=enc)
                     md_outputs.append(format_df_to_md(df, display_name, display_name))
                     break
                 except UnicodeDecodeError:
                     continue
    except Exception as e:
        return f"❌ 文件读取失败 [{display_name}]：{str(e)}"
    
    return "\n".join(md_outputs)