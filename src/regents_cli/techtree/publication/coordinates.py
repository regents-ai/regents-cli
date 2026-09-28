"""Where this build publishes, read off the ReleaseCore the package ships."""

from __future__ import annotations

from regents_cli.techtree.release.document import packaged_release_core_bytes, parse_release_core
from regents_cli.techtree.release.models import PublicationCoordinates


def packaged_publication_coordinates() -> PublicationCoordinates:
    """The endpoint, public log and network key this build's release pins."""
    return parse_release_core(packaged_release_core_bytes()).publication
