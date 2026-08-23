# Workspace seeds for `scripts/eval.sh`

A prompt whose subject is a repository, a directory, or a set of files cannot be measured in an
empty temp directory — the model correctly answers "there is nothing here", and that scores as a
rule failure it is not. `sample-prompts.py` filters those prompts out by default for exactly this
reason; a seed is how to put them back.

    zsh scripts/eval.sh "这仓库最近几次提交都改了啥" test/seeds/git

Each seed is a directory copied into the workspace before the run. `setup.sh`, if present, runs
inside the copy and is then deleted — that is how `git/` gets real history without checking a
`.git` into this repository, where it would nest.

| seed | what it provides |
| --- | --- |
| `git/` | three commits touching two files, so a history card has something to show |
