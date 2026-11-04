package bo.geopanel.mobile.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "positions",
    indices = [
        Index(value = ["isSynced", "fixTime"]),
        Index(value = ["packetId"], unique = true)
    ]
)
data class PositionEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val packetId: String,
    val uniqueId: String,
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Double,
    val course: Double,
    val accuracy: Double,
    val batteryLevel: Int,
    val fixTime: String,
    val isSynced: Boolean = false,
    val createdAt: Long = System.currentTimeMillis()
)
