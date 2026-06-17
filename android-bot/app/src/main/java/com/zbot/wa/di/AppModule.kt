package com.zbot.wa.di

import android.content.Context
import com.zbot.wa.data.AdminPrefs
import com.zbot.wa.data.AuthManager
import com.zbot.wa.data.BotRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideContext(@ApplicationContext ctx: Context): Context = ctx

    @Provides
    @Singleton
    fun provideAuthManager(ctx: Context): AuthManager = AuthManager(ctx)

    @Provides
    @Singleton
    fun provideBotRepository(ctx: Context): BotRepository = BotRepository(ctx)

    @Provides
    @Singleton
    fun provideAdminPrefs(ctx: Context): AdminPrefs = AdminPrefs(ctx)
}
