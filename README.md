# Perfil do Professor

Site estático (HTML, CSS e JavaScript puro) para publicar com GitHub Pages.

## Estrutura

```
index.html          Página inicial (apresentação e navegação)
projetos.html       Projetos
curriculo.html      Currículo
ensino.html         Ensino (Graduação e Pós-graduação)
simuladores/avl.html  Simulador de árvores AVL
assets/style.css    Estilo compartilhado
```

## Antes de publicar

1. Troque "Prof. Rafael" pelo nome completo em todas as páginas.
2. Substitua os cartões de exemplo em `projetos.html`, `curriculo.html` e `ensino.html`.
3. Em `ensino.html`, troque `https://exemplo.com/simulador-red-black` pelo link do seu simulador de red-black.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub, por exemplo `perfil-professor`.
2. No terminal, dentro desta pasta:

```bash
git init -b main
git add .
git commit -m "Primeira versão do perfil"
git remote add origin https://github.com/SEU-USUARIO/perfil-professor.git
git push -u origin main
```

3. No GitHub, abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
5. Aguarde alguns minutos. O site ficará em `https://SEU-USUARIO.github.io/perfil-professor/`.

Todos os links são relativos, então o site funciona tanto na raiz de um repositório `usuario.github.io` quanto em um subcaminho como o acima.

## Alterações depois

```bash
git add .
git commit -m "Atualiza projetos"
git push
```
