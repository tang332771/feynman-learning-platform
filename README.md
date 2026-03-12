# 费曼全栈学习评估平台 (Feynman-AI Platform)

本项目是一个基于 **AI 原生架构** 设计的全栈应用，旨在通过费曼学习法（以教促学）帮助用户深度掌握知识点。

##  技术架构
- **Frontend**: React 18 + Vite 5 + Context API (状态管理)
- **Backend**: Node.js (Express v5) + JWT (安全鉴权)
- **AI Stack**: 百度千帆 LLM API + Prompt Engineering (针对性逻辑约束)
- **Vector DB**: HNSWLib (本地向量索引，实现 RAG 检索增强)

##  核心亮点
- **RAG 架构集成**: 实现了本地知识库的切片检索，有效通过背景注入降低 AI 幻觉。
- **结构化评估**: 强制 LLM 采用 JSON Mode 输出，确保评估报告在前端的稳定渲染。
- **全栈闭环**: 独立完成从媒体流采集到后端逻辑处理、再到数据库建模的全流程开发。
