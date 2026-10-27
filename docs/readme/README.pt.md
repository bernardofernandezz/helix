<h1 align="center">
  <img src="../../resources/build/icon.png" alt="Helix" width="64" valign="middle" /> Helix
</h1>

<p align="center">
  <strong>Um ambiente de pesquisa agêntico para as ciências da vida.</strong><br/>
  Rode agentes de IA lado a lado nos seus projetos de pesquisa: analise dados, pesquise a literatura,
  conduza pipelines genômicos e mantenha cada etapa reprodutível.
</p>

<p align="center">
  <sub><a href="../../README.md">English</a></sub>
</p>

---

## Para quem é

- **Biólogos e biotecnologistas** que querem um assistente que leia suas tabelas, rode a análise e
  explique o resultado, sem precisar viver no terminal.
- **Bioinformatas** que rodam pipelines Nextflow ou Snakemake, trabalham em clusters HPC e querem
  agentes capazes de iniciar, acompanhar e depurar essas execuções.
- **Grupos de pesquisa** que precisam de análises auditáveis e repetíveis.

## O que já funciona

| Área                 | O que você tem                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Projetos de pesquisa | Cada projeto é uma pasta (ou um worktree git, se você usa git) com seus próprios agentes, terminais e arquivos.                      |
| Agentes              | Claude Code, Codex, Gemini CLI, OpenCode, Goose, Aider e qualquer outro agente de linha de comando, lado a lado, com status ao vivo. |
| Chat                 | Uma visão de chat estruturada com chamadas de ferramentas, aprovações, tabelas, fórmulas e gráficos inline.                          |
| Dados e notebooks    | Visualizador em grade para CSV/TSV, notebooks Jupyter com kernels reais, PDF, Markdown e imagens.                                    |
| Computação remota    | Hosts SSH para servidores e clusters, com terminais remotos e navegação de arquivos.                                                 |
| Automação            | Execuções agendadas de agentes, a CLI `helix` e skills instaláveis para os agentes.                                                  |

## Roadmap

1. **Primeira análise sem terminal.** O chat abre por padrão, com templates de projeto de pesquisa,
   detecção de ambientes conda e visualizadores para VCF, BED, GFF e FASTA.
2. **Ferramentas científicas para os agentes.** Skills e servidores MCP para PubMed, NCBI, UniProt,
   PDB/AlphaFold e Ensembl, além de ferramentas como BLAST, samtools e bcftools.
3. **Modo de dados sensíveis.** Apenas modelos locais, sem chamadas de rede externas e com um selo
   visível, imposto por projeto.
4. **Pipelines e HPC.** Painéis de progresso para Nextflow e Snakemake e acompanhamento de jobs
   SLURM via SSH.
5. **Reprodutibilidade.** Um registro de proveniência de comandos, versões e releases de bancos de
   dados, uma seção de métodos gerada automaticamente e exportação RO-Crate.

O app mobile não faz parte da primeira versão. Veja
[docs/reference/mobile-connection.md](../reference/mobile-connection.md).

## Instalação

Ainda não há builds publicados. Compile a partir do código:

```bash
git clone https://github.com/bernardofernandezz/helix.git
cd helix
pnpm install
pnpm dev
```

Requisitos: Node.js 24+, pnpm e as ferramentas de build da sua plataforma para módulos nativos
(Xcode command line tools no macOS, `build-essential` no Linux, Visual Studio Build Tools no Windows).

## Desenvolvimento

- Guia de contribuição: [.github/CONTRIBUTING.md](../../.github/CONTRIBUTING.md)
- Antes de abrir um pull request: `pnpm check:changed --maxWorkers=2`
- Typecheck: `pnpm tc` · Testes: `pnpm test` · Lint: `pnpm lint`

## Licença

O Helix é open source sob a [Licença MIT](../../LICENSE).
