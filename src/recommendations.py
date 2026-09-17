import pandas as pd

def assign_priority(excess_water):
    if excess_water > 500:
        return "High"
    elif excess_water > 200:
        return "Medium"
    else:
        return "Low"

def generate_recommendation(row):
    """
    Generate a water-saving recommendation
    based on server load and cooling efficiency.
    """

    server_load = row["server_load_percent"]
    cooling_efficiency = row["cooling_efficiency"]
    excess_water = row["estimated_excess_water"]

    if excess_water <= 0:
        return "No significant water wastage detected."

    if server_load < 40 and cooling_efficiency < 0.85:
        return (
            "Low server load with poor cooling efficiency. "
            "Inspect cooling equipment and optimize cooling settings."
        )

    if server_load > 80 and cooling_efficiency < 0.85:
        return (
            "High server load with poor cooling efficiency. "
            "Optimize cooling performance and check for overheating."
        )

    if server_load < 40:
        return (
            "High water consumption at low server load. "
            "Check for cooling-system leakage or unnecessary cooling."
        )

    if cooling_efficiency < 0.85:
        return (
            "Cooling efficiency is below the target. "
            "Inspect the cooling system and improve heat removal."
        )

    return (
        "Unusual water consumption detected. "
        "Monitor this event and investigate the cooling system."
    )


# Load the wastage results
df = pd.read_csv("data/water_wastage_results.csv")

# Generate recommendations
df["recommendation"] = df.apply(generate_recommendation, axis=1)

df["priority"] = df["estimated_excess_water"].apply(assign_priority)
# Save the updated results
df.to_csv("data/water_wastage_results.csv", index=False)

print("Recommendations generated successfully!")
print(df[[
    "timestamp",
    "server_load_percent",
    "cooling_efficiency",
    "estimated_excess_water",
    "recommendation"
]].head(10))