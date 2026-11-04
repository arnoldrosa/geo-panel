package bo.geopanel.mobile.data.local.dao

import androidx.room.*
import bo.geopanel.mobile.data.local.entity.PositionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface PositionDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertPosition(position: PositionEntity): Long

    @Query("SELECT * FROM positions WHERE isSynced = 0 ORDER BY id ASC LIMIT :limit")
    suspend fun getPendingPositions(limit: Int = 50): List<PositionEntity>

    @Query("DELETE FROM positions WHERE id = :id")
    suspend fun deletePosition(id: Long)

    @Query("DELETE FROM positions WHERE id IN (:ids)")
    suspend fun deletePositionsByIds(ids: List<Long>)

    @Query("UPDATE positions SET isSynced = 1 WHERE id IN (:ids)")
    suspend fun markAsSynced(ids: List<Long>)

    @Query("DELETE FROM positions WHERE isSynced = 1")
    suspend fun purgeSyncedPositions()

    @Query("SELECT COUNT(*) FROM positions WHERE isSynced = 0")
    fun getPendingCountFlow(): Flow<Int>

    @Query("SELECT * FROM positions ORDER BY id DESC LIMIT :limit")
    fun getRecentPositionsFlow(limit: Int = 30): Flow<List<PositionEntity>>
}
