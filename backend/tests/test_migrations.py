from alembic.config import Config
from alembic.script import ScriptDirectory

from api.config import BACKEND_DIR


def _script() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini")))


def test_single_head() -> None:
    assert len(_script().get_heads()) == 1


def test_revisions_form_one_chain_from_baseline() -> None:
    script = _script()
    chain = [rev.revision for rev in script.walk_revisions()]
    assert chain[-1] == "0001"
    assert len(chain) == len(set(chain))
    for rev in script.walk_revisions():
        assert rev.down_revision is None or isinstance(rev.down_revision, str)
