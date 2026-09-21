from fastapi import FastAPI

from axis_core.api.provisioning import router as provisioning_router
from axis_core.api.registry import router as registry_router
from axis_core.api.oracle import router as oracle_router


app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


# Off-chain APIs
app.include_router(provisioning_router, prefix="/provisioning", tags=["provisioning"])
app.include_router(registry_router, prefix="/registry", tags=["registry"])

# Oracle (legacy mock with jsonschema validation)
app.include_router(oracle_router)
