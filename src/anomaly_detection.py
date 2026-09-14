import pandas as pd
from sklearn.ensemble import IsolationForest

# Load the dataset
df = pd.read_csv("data/sensor_data.csv")

# Select the features for the model
features = [
    "server_load_percent",
    "outside_temperature",
    "cooling_efficiency",
    "water_consumption_liters"
]

X = df[features]

# Create the model
model = IsolationForest(
    contamination=0.02,
    random_state=42
)

# Train the model and predict anomalies
df["anomaly"] = model.fit_predict(X)

# Show the detected anomalies
anomalies = df[df["anomaly"] == -1]

print("Total readings:", len(df))
print("Anomalies detected:", len(anomalies))

print("\nDetected anomalies:")
print(anomalies[
    [
        "timestamp",
        "server_load_percent",
        "water_consumption_liters",
        "anomaly"
    ]
])

# Save the results
df.to_csv("data/anomaly_results.csv", index=False)

print("\nAnomaly detection completed!")