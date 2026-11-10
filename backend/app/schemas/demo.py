from pydantic import BaseModel

from .common import Location


class DemoAccount(BaseModel):
    user_id: str
    real_pin: str
    duress_pin: str


class SimulatedSos(BaseModel):
    event_id: str
    share_url: str | None = None


class SampleRequest(BaseModel):
    # Where to place the sample zones. Left out, they sit around a default city centre.
    centre: Location | None = None
