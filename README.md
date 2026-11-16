# SFX Studio

App web para gravar, editar e aplicar efeitos em sons pelo celular e exportar para o Godot.

Abrir: https://hvariedades999-source.github.io/sfx-studio/

- Gravação com medidor de volume, aviso de estouro, contagem regressiva e corte automático de silêncio
- Edição não destrutiva com desfazer/refazer, zoom por pinça, loop da seleção, espectrograma e curva de volume
- 20 efeitos (limpeza, dinâmica, EQ, tom, distorção, espaço) com prévia ao vivo e presets próprios
- Dividir gravação pelos silêncios e gerar variações para o jogo
- Mixagens em camadas com efeitos por camada e limitador no master
- Exportação WAV (com loop para o Godot), OGG e MP3 para WhatsApp, em lote, com volume padronizado (LUFS)
- Interface com onda fixa, abas, gavetas de efeito com A/B, tema claro e escuro
- Edição de trechos (recortar, copiar, colar, silenciar, efeito no trecho) e reparo no espectrograma
- Gerador de sons retrô estilo sfxr
- Pacote Godot (.tres AudioStreamRandomizer), preset em lote, mixagem com grade, cortes, fades e gravação de camada
- Efeitos de voz e espaço: de-esser, afinação, tom e timbre, vocoder, reverb de ambiente, ping-pong, flanger, phaser, wah
- Marcadores, zoom vertical, visão estéreo, normalizar trecho, loop perfeito, importar áudio de vídeo
- Gerador com ambientes, sons de interface, passos e sintetizador com teclado
- Automação de volume, pan e filtro na mixagem; envio direto para o Google Drive
- Backup e restauração da biblioteca, funciona sem internet

Bibliotecas incluídas em `vendor/`: lamejs (LGPL, MP3) e ogg-vorbis-encoder-js (BSD/MIT, OGG Vorbis).
