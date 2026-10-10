# Perfil do Professor

Site estático (HTML e CSS) para publicar com GitHub Pages.

## Estrutura

```
index.html          Início (apresentação com foto)
projetos.html       Projetos
curriculo.html      Currículo
ensino.html         Ensino (Graduação e Pós-graduação)
assets/style.css    Estilo (paleta inferida da foto)
assets/perfil.png   Foto de perfil
```

## Antes de publicar

1. Em `ensino.html`, substitua `URL_RED_BLACK` e `URL_AVL` pelos links dos simuladores.
2. Troque "Prof. Rafael" pelo nome completo, se quiser.
3. Substitua os cartões de exemplo em `projetos.html`, `curriculo.html` e `ensino.html`.

## Paleta

| Token | Cor | Origem na foto |
|---|---|---|
| `--navy` | `#1e2540` | camisa |
| `--ouro` | `#c8973f` | luz dourada e madeira da estante |
| `--creme` | `#f7f2e7` | parede iluminada |
| `--sky` | `#7c98b8` | azul do fundo |
| `--sage` | `#6e8f5e` | planta |
| `--terra` | `#b5653a` | livros e tom quente da pele |

## Publicar no GitHub Pages

```bash
git remote add origin https://github.com/SEU-USUARIO/perfil-professor.git
git push -u origin main
```

No GitHub: **Settings → Pages → Deploy from a branch → main → / (root)**.
O site ficará em `https://SEU-USUARIO.github.io/perfil-professor/`.
