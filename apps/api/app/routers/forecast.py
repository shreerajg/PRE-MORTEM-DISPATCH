from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query

from app.services.ml.baseline import baseline_forecast

# History is derived from dataset demand rows. When no matching history exists the
# endpoint reports that explicitly instead of inventing a series.

router = APIRouter(prefix="/api/v1", tags=["forecast"])


@router.get("/forecast")
def get_forecast(
    destination_id: str = Query(..., description="Destination id"),
    product_id: str = Query(..., description="Product id"),
    horizon: int = Query(4, ge=1, le=52, description="Forecast horizon"),
):
    # Build history from stored datasets; one demand row per dataset is one period.
    history: List[Dict[str, Any]] = []
    try:
        from app.repo import database as db

        datasets = db.list_datasets()  # newest first
        for ds in datasets:
            meta = ds.get("meta", {})
            demand_list = meta.get("demand", [])
            for dem in demand_list:
                if str(dem.get("destination_id")) == str(destination_id) and str(dem.get("product_id")) == str(product_id):
                    history.append({"quantity": float(dem.get("quantity", 0) or 0)})
                    break
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not read forecast history") from exc

    if not history:
        return {
            "destination_id": destination_id,
            "product_id": product_id,
            "horizon": horizon,
            "model": "baseline",
            "forecast": [],
            "history_used": [],
            "fallback": True,
            "reason": "insufficient_history",
        }

    # Datasets arrive newest first; the moving average expects oldest -> newest.
    history.reverse()

    forecast = baseline_forecast(history, horizon=horizon)

    return {
        "destination_id": destination_id,
        "product_id": product_id,
        "horizon": horizon,
        "model": "baseline",
        "forecast": forecast,
        "history_used": history,
        "fallback": False,
        "reason": None,
    }
