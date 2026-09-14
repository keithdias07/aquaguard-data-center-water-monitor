import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression

# Load the dataset
df = pd.read_csv("data/anomaly_results.csv")

# Prepare the data
X = df[["server_load_percent", "outside_temperature"]]
y = df["water_consumption_liters"]

# Train a simple baseline model
baseline_model = LinearRegression()
baseline_model.fit(X, y)

# Predict expected water consumption
df["expected_water_consumption"] = baseline_model.predict(X)

# Calculate estimated excess water
df["estimated_excess_water"] = (
    df["water_consumption_liters"]
    - df["expected_water_consumption"]
)

# Keep only positive excess values
df["estimated_excess_water"] = np.maximum(
    df["estimated_excess_water"],
    0
)

# Calculate total estimated excess water
total_excess = df["estimated_excess_water"].sum()

print("Total estimated excess water:", round(total_excess, 2), "liters")

# Show the top 10 highest excess readings
top_waste = df.sort_values(
    "estimated_excess_water",
    ascending=False
).head(10)

print("\nTop 10 estimated wastage events:")
print(top_waste[
    [
        "timestamp",
        "server_load_percent",
        "water_consumption_liters",
        "expected_water_consumption",
        "estimated_excess_water"
    ]
])

# Save results
df.to_csv("data/water_wastage_results.csv", index=False)

print("\nWastage calculation completed!")