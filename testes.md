# Roteiro de testes — MessAI

Checklist de testes manuais. O que é automatizado já roda em `npm test` (domínio puro + integração do runtime). Aqui ficam as verificações **ao vivo na UI**, que o sandbox não consegue exercitar.

## Antes de começar

```fish
cd ~/Projetos/koba
./abrir.sh --build        # OBRIGATÓRIO: sobe o runtime novo com os endpoints /duplicate e /layout
```

> Se abrir sem `--build`, o runtime velho ainda roda e Ctrl+D/alinhar vão falhar com toast de erro (404). Isso é esperado — basta rebuildar.

Automatizado (rode antes de testar à mão, tem que estar tudo verde):

```fish
npm test                  # 63 testes: domínio + integração (duplicar, layout)
npm run build             # type-check estrito
```

---

## 1. Leva atual — polir canvas (o foco desta rodada)

### 1.1 Duplicar nó (Ctrl+D e botão)
- [ ] Criar uma **nota**, escrever conteúdo e dar cor → selecionar → **Ctrl+D**. Deve surgir uma cópia deslocada ~32px com **mesmo texto e mesma cor**.
- [ ] Mesmo teste pelo **botão de duplicar** (ícone de cópia) na barra do nó.
- [ ] Criar um **terminal** (ex.: claude) → duplicar. Deve abrir **nova sessão** rodando o **mesmo comando/cwd/papel** — e **não** reaproveitar o PTY do original (os dois rodam em paralelo).
- [ ] Duplicar um nó com **papel (role)** atribuído → a cópia mantém o papel.
- [ ] Selecionar **vários** nós e Ctrl+D → todos duplicam.
- [ ] Confirmar que a cópia **persiste** após fechar e reabrir a janela.

### 1.2 Organizar em grade (Ctrl+Shift+T)
- [ ] Espalhar vários nós pela tela → **Ctrl+Shift+T** → devem se arrumar numa grade regular a partir do canto do conjunto.
- [ ] Com **2+ selecionados**, organiza só os selecionados; **sem seleção**, organiza todos.
- [ ] Nós ficam sem sobreposição e com espaçamento uniforme.

### 1.3 Barra de alinhar (2+ selecionados)
- [ ] Selecionar **2+ nós** → a **barra de alinhar** aparece no topo (central).
- [ ] Testar os 6 botões: **esquerda / centro-H / direita** e **topo / meio-V / base**. Cada um alinha pela borda certa sem mudar o tamanho dos nós.
- [ ] Botão de **grade** na mesma barra organiza a seleção.
- [ ] Com **1 nó** selecionado, a barra de alinhar **não** aparece (aparece só a barra de ação do nó).

### 1.4 Uma revisão só (sem conflito)
- [ ] Mover/alinhar vários nós de uma vez **não** gera erro de conflito (409) nem toast — o backend aplica tudo numa revisão única.

---

## 2. Regressão do canvas (não pode ter quebrado)

### 2.1 Criar e abrir nós
- [ ] Menu **+ (add)** abre e cria terminal / nota / texto.
- [ ] Abrir um agente (claude/shell) → terminal vivo, aceita digitação, mostra saída.
- [ ] Redimensionar e mover nós funciona.

### 2.2 Conexões (cabos)
- [ ] Criar **link** entre dois nós (Ctrl+L ou botão de conectar) → o cabo aparece com a **animação** de conexão.
- [ ] Mensagem entre nós conectados funciona nos dois sentidos.
- [ ] Excluir um nó remove os cabos ligados a ele.

### 2.3 Seleção / navegação
- [ ] **Ctrl** + arrastar = pan; **Alt** + scroll = zoom; arrastar na área vazia = seleção em caixa.
- [ ] **Delete** apaga os selecionados (via app, não pelo React Flow).
- [ ] Barra de zoom embaixo: + / − / minimapa.

---

## 3. Andares (floors) — parear com o Maestri

### 3.1 Pílula do workspace → vista 3D
- [ ] Clicar na **pílula do workspace** (canto inferior) abre a **vista 3D dos andares**; o rótulo muda para "Floors". Clicar de novo volta ao canvas.

### 3.2 Novo andar
- [ ] Na vista 3D, **+ New Floor** abre o diálogo **"Novo andar"** com: campo **Nome** + toggle **"Clonar layout do térreo"**.
- [ ] O diálogo abre **simples** — sem as opções de isolamento git à mostra.
- [ ] Expandir **"▸ Avançado — isolamento git"** revela worktree/branch/base.
- [ ] Criar um andar com nome → aparece na vista 3D e na sidebar.

### 3.3 Ground na sidebar
- [ ] Workspace com andares mostra uma entrada filha **"Ground"** na sidebar.
- [ ] Clicar em **Ground** seleciona o térreo; clicar num andar troca pra ele.
- [ ] Workspace **sem** andares não mostra Ground.

---

## 4. Ficou para as próximas levas (NÃO deve existir ainda)

Confirme que estes **ainda não estão** implementados (pra não confundir com bug):
grupos (Ctrl+G), copiar/colar (Ctrl+C/V), desfazer/refazer (Ctrl+Z), snap magnético, **elevar/acoplar** (o botão ainda só dá toast "em breve"), travar nó (position lock).

---

## Como reportar

Pra cada item que falhar, anota: **o que fez → o que esperava → o que aconteceu** (e print, se der). Comparar lado a lado com o Maestri quando for questão de parecer/animação.
