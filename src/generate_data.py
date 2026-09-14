import pandas as pd
import numpy as np

# Make the random values reproducible
np.random.seed(42)

# Create 30 days of hourly timestamps
timestamps = pd.date_range(
    start="2026-01-01",
    periods=30 * 24,
    freq="h"
)

# Generate sensor readings
server_load = np.random.uniform(20, 95, len(timestamps))

outside_temperature = np.random.uniform(20, 40, len(timestamps))

cooling_efficiency = np.random.uniform(0.75, 0.95, len(timestamps))

# Calculate water consumption
water_consumption = (
    100
    + server_load * 4
    + outside_temperature * 3
    + (1 - cooling_efficiency) * 1000
    + np.random.normal(0, 30, len(timestamps))
)

# Create a DataFrame
data = {
    "timestamp": timestamps,
    "server_load_percent": server_load,
    "outside_temperature": outside_temperature,
    "cooling_efficiency": cooling_efficiency,
    "water_consumption_liters": water_consumption
}

df = pd.DataFrame(data)

# Add simulated water-waste events
waste_indices = np.random.choice(
    len(df),
    size=10,
    replace=False
)

df.loc[waste_indices, "water_consumption_liters"] *= 2

# Save the dataset
df.to_csv("data/sensor_data.csv", index=False)

print("Dataset generated successfully!")
print(df.head())